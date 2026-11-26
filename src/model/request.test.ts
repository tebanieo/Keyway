import { describe, expect, it } from "vitest";
import { cliCommand, pick, refsIn, unusedAcross } from "./request";

describe("cliCommand", () => {
  it("writes a query with every parameter, one per line", () => {
    const cmd = cliCommand({
      op: "query",
      tableName: "OrdersTable",
      indexName: "ByRegion",
      keyConditionExpression: "tenant = :t AND #r = :r",
      filterExpression: "attribute_exists(#s)",
      names: { "#r": "region", "#s": "status" },
      values: { ":t": { S: "acme" }, ":r": { S: "us" } },
      consistentRead: true,
    });
    expect(cmd.split(" \\\n  ")).toEqual([
      "aws dynamodb query",
      "--table-name 'OrdersTable'",
      "--index-name 'ByRegion'",
      "--key-condition-expression 'tenant = :t AND #r = :r'",
      "--filter-expression 'attribute_exists(#s)'",
      `--expression-attribute-names '{"#r":"region","#s":"status"}'`,
      `--expression-attribute-values '{":t":{"S":"acme"},":r":{"S":"us"}}'`,
      "--consistent-read",
    ]);
  });

  it("quotes a single quote safely for the shell", () => {
    const cmd = cliCommand({
      op: "scan",
      tableName: "T",
      values: { ":n": { S: "O'Brien" } },
      filterExpression: "n = :n",
    });
    expect(cmd).toContain(`'{":n":{"S":"O'\\''Brien"}}'`);
  });

  it("writes get-item with its Key and no expression parameters", () => {
    const cmd = cliCommand({
      op: "get",
      tableName: "T",
      key: { PK: { S: "A" }, SK: { N: "1" } },
      keyConditionExpression: "ignored",
    });
    expect(cmd).toBe(
      `aws dynamodb get-item \\\n  --table-name 'T' \\\n  --key '{"PK":{"S":"A"},"SK":{"N":"1"}}'`,
    );
  });
});

describe("refsIn / pick / unusedAcross", () => {
  it("finds the #names and :values an expression uses", () => {
    expect(refsIn("#a = :x AND begins_with(b, :y)")).toEqual({
      names: new Set(["#a"]),
      values: new Set([":x", ":y"]),
    });
    expect(pick({ ":x": 1, ":z": 2 }, new Set([":x"]))).toEqual({ ":x": 1 });
  });

  it("applies the API's rule across the whole request", () => {
    const values = { ":k": { S: "a" }, ":f": { S: "b" } };
    expect(unusedAcross(["PK = :k", "x = :f"], {}, values)).toBeNull();
    expect(unusedAcross(["PK = :k"], {}, values)).toMatch(/unused in expressions: keys: \{:f\}/);
  });
});
