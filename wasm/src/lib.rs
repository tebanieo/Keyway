//! WASM bindings over `extenddb-core`, giving Keyway real DynamoDB expression
//! semantics in the browser. Values cross the boundary as DynamoDB wire JSON
//! (`{"S":"x"}`, `{"N":"1"}`), so no custom type mapping is needed.

use std::collections::{HashMap, HashSet};

use extenddb_core::error::DynamoDbError;
use extenddb_core::expression::{
    Expr, ExpressionMaps, evaluate_condition, parse_condition_with_depth_limit,
    tokenize_with_limit, validate_no_reserved_words, validate_ordering_operand_types,
    validate_unused_attributes,
};
use extenddb_core::limits::LimitsConfig;
use extenddb_core::types::{AttributeValue, Item, item_size_bytes};
use wasm_bindgen::prelude::*;

fn parse_json<T: serde::de::DeserializeOwned>(what: &str, s: &str) -> Result<T, String> {
    serde_json::from_str(s).map_err(|e| format!("invalid {what} JSON: {e}"))
}

fn strip<V>(map: HashMap<String, V>, prefix: char) -> HashMap<String, V> {
    map.into_iter()
        .map(|(k, v)| (k.strip_prefix(prefix).map(str::to_owned).unwrap_or(k), v))
        .collect()
}

/// Label an error the way DynamoDB does for a ConditionExpression.
fn labelled(err: DynamoDbError) -> String {
    let msg = err.message();
    if msg.starts_with("Invalid ConditionExpression:") || msg.starts_with("Value provided") {
        msg.to_string()
    } else if let Some(rest) = msg.strip_prefix("Invalid expression:") {
        format!("Invalid ConditionExpression:{rest}")
    } else {
        format!("Invalid ConditionExpression: {msg}")
    }
}

/// Parse and validate a ConditionExpression the way ExtendDB's PutItem does:
/// token limit, reserved words, parse (with depth limit and redundant-paren
/// check), operand types, and no unused names or values.
///
/// `names` and `values` are JSON strings: `ExpressionAttributeNames` as a
/// string map and `ExpressionAttributeValues` in DynamoDB wire format. Empty
/// strings mean "none".
pub fn prepare(expr: &str, names: &str, values: &str) -> Result<(Expr, ExpressionMaps), String> {
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
    // The wire format keys placeholders as `#n` / `:v`; extenddb-core keys them
    // bare, as its engine does after stripping the prefix.
    let maps = ExpressionMaps::new(strip(names, '#'), strip(values, ':'));
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
    // Evaluating against an empty item resolves every placeholder, so an
    // undefined `#name` or `:value` is reported here rather than at write time.
    evaluate_condition(&ast, &Item::new(), &maps).map_err(labelled)?;
    Ok((ast, maps))
}

/// Evaluate a ConditionExpression (or FilterExpression) against one item, in
/// DynamoDB wire format. Validates it first, exactly as [`prepare`] does.
pub fn condition(expr: &str, item: &str, names: &str, values: &str) -> Result<bool, String> {
    let item: Item = parse_json("item", item)?;
    let (ast, maps) = prepare(expr, names, values)?;
    evaluate_condition(&ast, &item, &maps).map_err(labelled)
}

/// Size of an item in bytes, as DynamoDB counts it for capacity units.
pub fn size(item: &str) -> Result<usize, String> {
    let item: Item = parse_json("item", item)?;
    Ok(item_size_bytes(&item))
}

#[wasm_bindgen(js_name = evaluateCondition)]
pub fn evaluate_condition_js(
    expr: &str,
    item: &str,
    names: &str,
    values: &str,
) -> Result<bool, JsError> {
    condition(expr, item, names, values).map_err(|e| JsError::new(&e))
}

/// Validate a ConditionExpression without evaluating it. Throws DynamoDB's
/// ValidationException message when it's invalid.
#[wasm_bindgen(js_name = validateCondition)]
pub fn validate_condition_js(expr: &str, names: &str, values: &str) -> Result<(), JsError> {
    prepare(expr, names, values)
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
        assert!(condition("attribute_exists(PK)", ITEM, "", "").unwrap());
        assert!(!condition("attribute_not_exists(PK)", ITEM, "", "").unwrap());
        assert!(condition("age > :n", ITEM, "", r#"{":n":{"N":"40"}}"#).unwrap());
        assert!(condition("contains(tags, :t)", ITEM, "", r#"{":t":{"S":"b"}}"#).unwrap());
        assert!(
            condition(
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
        assert!(condition("age >", ITEM, "", "").is_err());
        assert!(condition("age > :missing", ITEM, "", "").is_err());
    }

    #[test]
    fn validates_like_dynamodb() {
        let err = |e, n, v| prepare(e, n, v).unwrap_err();
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
        assert!(prepare("#s = :s", r##"{"#s":"status"}"##, r#"{":s":{"S":"x"}}"#).is_ok());
    }

    #[test]
    fn sizes_items() {
        assert!(size(ITEM).unwrap() > 0);
    }
}
