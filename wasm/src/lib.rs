//! WASM bindings over `extenddb-core`, giving Keyway real DynamoDB expression
//! semantics in the browser. Values cross the boundary as DynamoDB wire JSON
//! (`{"S":"x"}`, `{"N":"1"}`), so no custom type mapping is needed.

use std::collections::HashMap;

use extenddb_core::expression::{ExpressionMaps, evaluate_condition, parse_condition, tokenize};
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

/// Evaluate a ConditionExpression (or FilterExpression) against one item.
///
/// `item`, `names` and `values` are JSON strings: the item and
/// `ExpressionAttributeValues` in DynamoDB wire format, and
/// `ExpressionAttributeNames` as a plain string map. Empty strings mean "none".
pub fn condition(expr: &str, item: &str, names: &str, values: &str) -> Result<bool, String> {
    let item: Item = parse_json("item", item)?;
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
    let tokens = tokenize(expr).map_err(|e| e.message().to_string())?;
    let ast = parse_condition(&tokens).map_err(|e| e.message().to_string())?;
    evaluate_condition(&ast, &item, &maps).map_err(|e| e.message().to_string())
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
    fn sizes_items() {
        assert!(size(ITEM).unwrap() > 0);
    }
}
