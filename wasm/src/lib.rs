//! WASM bindings over `extenddb-core`, giving Keyway real DynamoDB expression
//! semantics in the browser. Values cross the boundary as DynamoDB wire JSON
//! (`{"S":"x"}`, `{"N":"1"}`), so no custom type mapping is needed.

use std::collections::{HashMap, HashSet};

use extenddb_core::error::DynamoDbError;
use extenddb_core::expression::{
    Expr, ExpressionMaps, PathElement, collect_key_condition_refs, collect_value_placeholders,
    evaluate_condition, parse_condition_with_depth_limit, parse_key_condition, tokenize_with_limit,
    validate_begins_with_operands, validate_no_reserved_words, validate_ordering_operand_types,
    validate_unused_attributes,
};
use extenddb_core::limits::LimitsConfig;
use extenddb_core::types::{
    AttributeValue, Item, KeySchemaElement, KeyType, is_multipart_key_schema, item_size_bytes,
};
use wasm_bindgen::prelude::*;

fn parse_json<T: serde::de::DeserializeOwned>(what: &str, s: &str) -> Result<T, String> {
    serde_json::from_str(s).map_err(|e| format!("invalid {what} JSON: {e}"))
}

fn strip<V>(map: HashMap<String, V>, prefix: char) -> HashMap<String, V> {
    map.into_iter()
        .map(|(k, v)| (k.strip_prefix(prefix).map(str::to_owned).unwrap_or(k), v))
        .collect()
}

/// Which request parameter an expression is: they share one grammar, but
/// DynamoDB labels their errors, and validates them, differently.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `ConditionExpression` on a write (PutItem, DeleteItem, ...).
    Condition,
    /// `FilterExpression` on a Query or Scan.
    Filter,
    /// `KeyConditionExpression` on a Query.
    Key,
}

impl Kind {
    fn parse(kind: &str) -> Result<Self, String> {
        match kind {
            "condition" => Ok(Self::Condition),
            "filter" => Ok(Self::Filter),
            "key" => Ok(Self::Key),
            other => Err(format!("unknown expression kind {other:?}")),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Condition => "ConditionExpression",
            Self::Filter => "FilterExpression",
            Self::Key => "KeyConditionExpression",
        }
    }

    /// Label an error the way DynamoDB does for this kind of expression, as
    /// ExtendDB's engine does (`prefix_expression_error`).
    fn labelled(self, err: DynamoDbError) -> String {
        let label = self.label();
        let msg = err.message();
        if let Some(rest) = msg
            .strip_prefix("Invalid ConditionExpression:")
            .or_else(|| msg.strip_prefix("Invalid expression:"))
        {
            format!("Invalid {label}:{rest}")
        } else if msg.starts_with("Invalid ") || msg.starts_with("Value provided") {
            msg.to_string()
        } else {
            format!("Invalid {label}: {msg}")
        }
    }
}

/// Parse and validate an expression the way ExtendDB's engine does: token
/// limit, reserved words, parse (with depth limit and redundant-paren check),
/// operand types (plus `begins_with` operands for a filter, as Query/Scan
/// check), and no unused names or values.
///
/// `names` and `values` are JSON strings: `ExpressionAttributeNames` as a
/// string map and `ExpressionAttributeValues` in DynamoDB wire format. Empty
/// strings mean "none".
pub fn prepare(
    kind: Kind,
    expr: &str,
    names: &str,
    values: &str,
) -> Result<(Expr, ExpressionMaps), String> {
    let labelled = |e| kind.labelled(e);
    let maps = maps_from_json(names, values)?;
    let limits = LimitsConfig::default();
    let tokens = tokenize_with_limit(expr, limits.max_expression_tokens).map_err(labelled)?;
    validate_no_reserved_words(&tokens).map_err(labelled)?;
    let ast =
        parse_condition_with_depth_limit(&tokens, limits.max_expression_depth).map_err(labelled)?;
    validate_ordering_operand_types(&ast, &maps).map_err(labelled)?;
    validate_unused_attributes(
        &maps.names,
        &maps.values,
        &[&ast],
        &[],
        &HashSet::new(),
        &HashSet::new(),
    )
    .map_err(labelled)?;
    check_every_clause(&ast, &maps).map_err(labelled)?;
    Ok((ast, maps))
}

/// Check every clause of `ast` on its own, so nothing hides behind `AND`/`OR`
/// short-circuiting: evaluating the whole expression against an empty item
/// stops at the first clause that decides it, and a typo after it would only
/// surface later, against a real item. Checks that every `#name` and `:value`
/// is defined, `begins_with` operand types, and each comparison (including
/// `BETWEEN`'s bound order and types) by evaluating it alone.
fn check_every_clause(ast: &Expr, maps: &ExpressionMaps) -> Result<(), DynamoDbError> {
    let mut placeholders = Vec::new();
    collect_value_placeholders(ast, &mut placeholders);
    for p in placeholders {
        let bare = p.strip_prefix(':').unwrap_or(&p);
        maps.resolve_value(bare)?;
    }
    check_names(ast, maps)?;
    validate_begins_with_operands(ast, maps)?;
    check_clauses(ast, maps)
}

fn check_names(expr: &Expr, maps: &ExpressionMaps) -> Result<(), DynamoDbError> {
    let path = |p: &[PathElement]| -> Result<(), DynamoDbError> {
        for el in p {
            if let PathElement::Attribute(a) = el
                && let Some(r) = a.strip_prefix('#')
            {
                maps.resolve_name(r)?;
            }
        }
        Ok(())
    };
    match expr {
        Expr::Path(p) => path(p),
        Expr::Placeholder(_) => Ok(()),
        Expr::Compare { left, right, .. } | Expr::Arithmetic { left, right, .. } => {
            check_names(left, maps)?;
            check_names(right, maps)
        }
        Expr::And(a, b) | Expr::Or(a, b) => {
            check_names(a, maps)?;
            check_names(b, maps)
        }
        Expr::Not(a) => check_names(a, maps),
        Expr::Function { args, .. } => args.iter().try_for_each(|a| check_names(a, maps)),
        Expr::Between { operand, low, high } => {
            check_names(operand, maps)?;
            check_names(low, maps)?;
            check_names(high, maps)
        }
        Expr::In { operand, list } => {
            check_names(operand, maps)?;
            list.iter().try_for_each(|a| check_names(a, maps))
        }
    }
}

fn check_clauses(expr: &Expr, maps: &ExpressionMaps) -> Result<(), DynamoDbError> {
    match expr {
        Expr::And(a, b) | Expr::Or(a, b) => {
            check_clauses(a, maps)?;
            check_clauses(b, maps)
        }
        Expr::Not(a) => check_clauses(a, maps),
        leaf => evaluate_condition(leaf, &Item::new(), maps).map(drop),
    }
}

fn maps_from_json(names: &str, values: &str) -> Result<ExpressionMaps, String> {
    let names: HashMap<String, String> = if names.is_empty() {
        HashMap::new()
    } else {
        parse_json("names", names)?
    };
    let values: HashMap<String, AttributeValue> = if values.is_empty() {
        HashMap::new()
    } else {
        parse_json("values", values)?
    };
    Ok(ExpressionMaps::new(strip(names, '#'), strip(values, ':')))
}

/// The attribute a key-condition path names, with `#name` resolved.
fn path_attr(path: &[PathElement], maps: &ExpressionMaps) -> Option<String> {
    match path.first() {
        Some(PathElement::Attribute(name)) => match name.strip_prefix('#') {
            Some(r) => maps.names.get(r).cloned(),
            None => Some(name.clone()),
        },
        _ => None,
    }
}

/// Parse and validate a KeyConditionExpression for a Query on an index whose
/// key schema is `hash` (partition key attributes, in order) and `range` (sort
/// key attributes), as ExtendDB's Query does: reserved words, the restricted
/// key-condition grammar, assignment of every clause to a key attribute
/// (including multi-attribute keys), and unused placeholders. Returns the
/// expression parsed as a condition, which is how items are matched.
pub fn prepare_key(
    expr: &str,
    names: &str,
    values: &str,
    hash: &[String],
    range: &[String],
) -> Result<(Expr, ExpressionMaps), String> {
    let kind = Kind::Key;
    let labelled = |e| kind.labelled(e);
    let maps = maps_from_json(names, values)?;
    let limits = LimitsConfig::default();
    let tokens = tokenize_with_limit(expr, limits.max_expression_tokens).map_err(labelled)?;
    validate_no_reserved_words(&tokens).map_err(labelled)?;
    let mut kc = parse_key_condition(&tokens).map_err(labelled)?;

    let schema: Vec<KeySchemaElement> = hash
        .iter()
        .map(|a| (a, KeyType::Hash))
        .chain(range.iter().map(|a| (a, KeyType::Range)))
        .map(|(a, key_type)| KeySchemaElement {
            attribute_name: a.clone(),
            key_type,
        })
        .collect();
    kc.resolve_key_schema(&schema, &maps.names)
        .map_err(labelled)?;

    // A single-attribute key schema: ExtendDB's Query checks the partition
    // key clause; the sort key clause it leaves to storage. Keyway has no
    // storage layer, so it checks that clause names the sort key here.
    if !is_multipart_key_schema(&schema) {
        let missed = |attr: &String| format!("Query condition missed key schema element: {attr}");
        if let Some(pk) = hash.first()
            && path_attr(&kc.pk_path, &maps).as_ref() != Some(pk)
        {
            return Err(missed(pk));
        }
        if let Some(sk) = &kc.sk_condition {
            match range.first() {
                Some(range_attr) if path_attr(sk.path(), &maps).as_ref() == Some(range_attr) => {}
                Some(range_attr) => return Err(missed(range_attr)),
                None => return Err("Query key condition not supported".to_owned()),
            }
        }
    }

    let (kc_names, kc_values) = collect_key_condition_refs(&kc);
    validate_unused_attributes(&maps.names, &maps.values, &[], &[], &kc_names, &kc_values)
        .map_err(labelled)?;

    let ast =
        parse_condition_with_depth_limit(&tokens, limits.max_expression_depth).map_err(labelled)?;
    check_every_clause(&ast, &maps).map_err(labelled)?;
    Ok((ast, maps))
}

/// Evaluate an expression against one item, in DynamoDB wire format.
/// Validates it first, exactly as [`prepare`] does.
pub fn evaluate(
    kind: Kind,
    expr: &str,
    item: &str,
    names: &str,
    values: &str,
) -> Result<bool, String> {
    let item: Item = parse_json("item", item)?;
    let (ast, maps) = prepare(kind, expr, names, values)?;
    evaluate_condition(&ast, &item, &maps).map_err(|e| kind.labelled(e))
}

/// Size of an item in bytes, as DynamoDB counts it for capacity units.
pub fn size(item: &str) -> Result<usize, String> {
    let item: Item = parse_json("item", item)?;
    Ok(item_size_bytes(&item))
}

/// Evaluate an expression (`kind` is "condition" or "filter") against one item.
#[wasm_bindgen(js_name = evaluateExpression)]
pub fn evaluate_expression_js(
    kind: &str,
    expr: &str,
    item: &str,
    names: &str,
    values: &str,
) -> Result<bool, JsError> {
    Kind::parse(kind)
        .and_then(|k| evaluate(k, expr, item, names, values))
        .map_err(|e| JsError::new(&e))
}

/// Validate an expression (`kind` is "condition" or "filter") without
/// evaluating it. Throws DynamoDB's ValidationException message when invalid.
#[wasm_bindgen(js_name = validateExpression)]
pub fn validate_expression_js(
    kind: &str,
    expr: &str,
    names: &str,
    values: &str,
) -> Result<(), JsError> {
    Kind::parse(kind)
        .and_then(|k| prepare(k, expr, names, values))
        .map(drop)
        .map_err(|e| JsError::new(&e))
}

/// Validate a KeyConditionExpression against an index's key schema (`hash` and
/// `range` are JSON arrays of attribute names). Throws DynamoDB's message.
#[wasm_bindgen(js_name = validateKeyCondition)]
pub fn validate_key_condition_js(
    expr: &str,
    names: &str,
    values: &str,
    hash: &str,
    range: &str,
) -> Result<(), JsError> {
    let attrs = |s: &str| parse_json::<Vec<String>>("key schema", s);
    attrs(hash)
        .and_then(|h| attrs(range).map(|r| (h, r)))
        .and_then(|(h, r)| prepare_key(expr, names, values, &h, &r))
        .map(drop)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = itemSize)]
pub fn item_size_js(item: &str) -> Result<usize, JsError> {
    size(item).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ITEM: &str = r#"{"PK":{"S":"USER#1"},"age":{"N":"42"},"tags":{"SS":["a","b"]}}"#;

    #[test]
    fn evaluates_conditions() {
        assert!(evaluate(Kind::Condition, "attribute_exists(PK)", ITEM, "", "").unwrap());
        assert!(!evaluate(Kind::Condition, "attribute_not_exists(PK)", ITEM, "", "").unwrap());
        assert!(
            evaluate(
                Kind::Condition,
                "age > :n",
                ITEM,
                "",
                r#"{":n":{"N":"40"}}"#
            )
            .unwrap()
        );
        assert!(
            evaluate(
                Kind::Condition,
                "contains(tags, :t)",
                ITEM,
                "",
                r#"{":t":{"S":"b"}}"#
            )
            .unwrap()
        );
        assert!(
            evaluate(
                Kind::Condition,
                "begins_with(#p, :x)",
                ITEM,
                r##"{"#p":"PK"}"##,
                r#"{":x":{"S":"USER#"}}"#
            )
            .unwrap()
        );
    }

    #[test]
    fn reports_errors() {
        assert!(evaluate(Kind::Condition, "age >", ITEM, "", "").is_err());
        assert!(evaluate(Kind::Condition, "age > :missing", ITEM, "", "").is_err());
    }

    #[test]
    fn validates_like_dynamodb() {
        let err = |e, n, v| prepare(Kind::Condition, e, n, v).unwrap_err();
        assert!(err("status = :s", "", r#"{":s":{"S":"x"}}"#).contains("reserved keyword"));
        assert!(
            err("attribute_exists(PK)", "", r#"{":s":{"S":"x"}}"#)
                .contains("ExpressionAttributeValues unused")
        );
        assert!(
            err("attribute_exists(PK)", r##"{"#s":"status"}"##, "")
                .contains("ExpressionAttributeNames unused")
        );
        assert!(err("#s = :s", "", r#"{":s":{"S":"x"}}"#).contains("#s"));
        assert!(
            prepare(
                Kind::Condition,
                "#s = :s",
                r##"{"#s":"status"}"##,
                r#"{":s":{"S":"x"}}"#
            )
            .is_ok()
        );
    }

    #[test]
    fn sizes_items() {
        assert!(size(ITEM).unwrap() > 0);
    }

    #[test]
    fn labels_errors_by_kind() {
        let msg = |k| prepare(k, "status = :s", "", r#"{":s":{"S":"x"}}"#).unwrap_err();
        assert!(msg(Kind::Condition).starts_with("Invalid ConditionExpression:"));
        assert!(msg(Kind::Filter).starts_with("Invalid FilterExpression:"));
    }

    #[test]
    fn filters_check_begins_with_operands() {
        let n = r#"{":n":{"N":"1"}}"#;
        assert!(prepare(Kind::Filter, "begins_with(PK, :n)", "", n).is_err());
    }

    fn key(expr: &str, values: &str, hash: &[&str], range: &[&str]) -> Result<(), String> {
        let v = |a: &[&str]| a.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        prepare_key(expr, "", values, &v(hash), &v(range)).map(drop)
    }

    #[test]
    fn validates_key_conditions_against_the_key_schema() {
        let u = r#"{":u":{"S":"USER#1"},":o":{"S":"ORDER#"}}"#;
        let pk = r#"{":u":{"S":"USER#1"}}"#;
        assert!(key("PK = :u AND begins_with(SK, :o)", u, &["PK"], &["SK"]).is_ok());
        assert!(key("PK = :u", pk, &["PK"], &["SK"]).is_ok());
        // the clauses can come in either order
        assert!(key("begins_with(SK, :o) AND PK = :u", u, &["PK"], &["SK"]).is_ok());
        // partition key must be equality, and present
        let e = key(
            "begins_with(SK, :o)",
            r#"{":o":{"S":"x"}}"#,
            &["PK"],
            &["SK"],
        )
        .unwrap_err();
        assert!(
            e.contains("KeyConditionExpression") || e.contains("missed key schema"),
            "{e}"
        );
        let e = key("GSI1PK = :u", pk, &["PK"], &["SK"]).unwrap_err();
        assert!(e.contains("missed key schema element: PK"), "{e}");
        // a non-key attribute in place of the sort key
        let e = key("PK = :u AND price = :o", u, &["PK"], &["SK"]).unwrap_err();
        assert!(e.contains("missed key schema element: SK"), "{e}");
        // OR is not allowed
        assert!(key("PK = :u OR SK = :o", u, &["PK"], &["SK"]).is_err());
        // unused value
        let e = key("PK = :u", u, &["PK"], &["SK"]).unwrap_err();
        assert!(e.contains("ExpressionAttributeValues unused"), "{e}");
    }

    #[test]
    fn validates_multi_attribute_keys() {
        let v = |a: &[&str]| a.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let h = v(&["tenant", "region"]);
        let names = r##"{"#s":"status","#g":"region"}"##;
        let vals = r#"{":t":{"S":"acme"},":r":{"S":"eu"},":s":{"S":"open"},":d":{"S":"2024"}}"#;
        let range = v(&["status", "opened"]);
        let ok = "tenant = :t AND #g = :r AND #s = :s AND begins_with(opened, :d)";
        assert_eq!(prepare_key(ok, names, vals, &h, &range).map(drop), Ok(()));
        // every partition key attribute needs an equality
        let vals2 = r#"{":t":{"S":"acme"},":s":{"S":"open"}}"#;
        let names2 = r##"{"#s":"status"}"##;
        assert!(prepare_key("tenant = :t AND #s = :s", names2, vals2, &h, &range).is_err());
        // only the last sort key given may use a range
        let bad = "tenant = :t AND #g = :r AND begins_with(#s, :s) AND opened = :d";
        assert!(prepare_key(bad, names, vals, &h, &range).is_err());
    }

    /// The reviewer's cases: each hid a mistake behind a clause that already
    /// decided the result, so it passed validation and threw later.
    #[test]
    fn checks_clauses_behind_and_or() {
        let c = |e: &str, n: &str, v: &str| prepare(Kind::Condition, e, n, v).map(drop);
        assert!(
            c(
                "attribute_not_exists(PK) OR #s = :s",
                "",
                r#"{":s":{"S":"x"}}"#
            )
            .unwrap_err()
            .contains("#s")
        );
        assert!(
            c("attribute_exists(PK) AND a = :x", "", "")
                .unwrap_err()
                .contains(":x")
        );
        let n = r#"{":p":{"N":"2024"}}"#;
        assert!(
            c("attribute_exists(PK) AND begins_with(SK, :p)", "", n)
                .unwrap_err()
                .contains("begins_with")
        );
        let rev = r#"{":x":{"N":"5"},":y":{"N":"1"}}"#;
        let f = prepare(
            Kind::Filter,
            "attribute_exists(a) AND n BETWEEN :x AND :y",
            "",
            rev,
        );
        assert!(f.unwrap_err().contains("BETWEEN"));
        let mixed = r#"{":x":{"N":"1"},":y":{"S":"z"}}"#;
        let f = prepare(
            Kind::Filter,
            "attribute_exists(a) OR n BETWEEN :x AND :y",
            "",
            mixed,
        );
        assert!(f.unwrap_err().contains("same data type"));
        // contains() with an undefined value, behind nothing at all
        assert!(
            c("contains(a, :nope)", "", "")
                .unwrap_err()
                .contains(":nope")
        );
    }

    #[test]
    fn checks_key_condition_clauses_too() {
        let v = |a: &[&str]| a.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let (h, r) = (v(&["PK"]), v(&["SK"]));
        let k = |e: &str, vals: &str| prepare_key(e, "", vals, &h, &r).map(drop);
        let d = r#"{":u":{"S":"U"},":d":{"N":"2024"}}"#;
        assert!(
            k("PK = :u AND begins_with(SK, :d)", d)
                .unwrap_err()
                .contains("begins_with")
        );
        assert!(
            k("PK = :p AND SK > :typo", r#"{":p":{"S":"A"}}"#)
                .unwrap_err()
                .contains(":typo")
        );
        let rev = r#"{":pk":{"S":"U"},":a":{"S":"b"},":b":{"S":"a"}}"#;
        assert!(
            k("PK = :pk AND SK BETWEEN :a AND :b", rev)
                .unwrap_err()
                .contains("BETWEEN")
        );
        // and a correct one still passes
        let ok = r#"{":u":{"S":"U"},":d":{"S":"2024"}}"#;
        assert_eq!(k("PK = :u AND begins_with(SK, :d)", ok), Ok(()));
    }
}
