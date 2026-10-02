/** Transitional Dynamo adapter. The shared ledger lives in @elixir-mcp/clan-state. */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { timedStore } from "../trace.mjs";

import { ledgerOver } from "@elixir-mcp/clan-state";
export { createMemoryLedger, newId } from "@elixir-mcp/clan-state";

const clanKey = (tag) => `clan#${tag}`;

export function createDynamoLedger({ tableName, region }) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const doc = {
    send: (command) =>
      timedStore(
        `${command.constructor.name.replace("Command", "")} ${String(command.input?.Key?.pk ?? command.input?.Item?.pk ?? command.input?.ExpressionAttributeValues?.[":p"] ?? "").split("#")[0] || "query"}`,
        () => client.send(command),
      ),
  };
  async function put(item) {
    await doc.send(new PutCommand({ TableName: tableName, Item: item }));
  }
  async function get(pk) {
    const { Item } = await doc.send(
      new GetCommand({ TableName: tableName, Key: { pk } }),
    );
    return Item ?? null;
  }
  async function listByPartition(partition, prefix) {
    const items = [];
    let key;
    do {
      const page = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "ByClan",
          // DynamoDB forbids an empty string for an index key. An empty
          // prefix means the whole partition, not an empty sort-key value.
          KeyConditionExpression: prefix
            ? "gsi1pk = :c and begins_with(gsi1sk, :p)"
            : "gsi1pk = :c",
          ExpressionAttributeValues: prefix
            ? { ":c": partition, ":p": prefix }
            : { ":c": partition },
          ExclusiveStartKey: key,
        }),
      );
      items.push(...(page.Items ?? []));
      key = page.LastEvaluatedKey;
    } while (key);
    return items;
  }
  const listByPrefix = (clanTag, prefix) =>
    listByPartition(clanKey(clanTag), prefix);
  /** Add one to a counter item and answer the new value (atomic). */
  async function increment(pk) {
    const { Attributes } = await doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk },
        UpdateExpression: "ADD #n :one",
        ExpressionAttributeNames: { "#n": "n" },
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(Attributes.n);
  }
  /** Mark an item as taken for `day`; false when it already was today
   *  (a conditional write, so two callers never both get it). */
  async function claimDay(pk, day, at) {
    try {
      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk },
          UpdateExpression: "SET #d = :d, #at = :at",
          ConditionExpression: "attribute_not_exists(#d) OR #d <> :d",
          ExpressionAttributeNames: { "#d": "day", "#at": "at" },
          ExpressionAttributeValues: { ":d": day, ":at": at },
        }),
      );
      return true;
    } catch (e) {
      if (e?.name === "ConditionalCheckFailedException") return false;
      throw e;
    }
  }
  /** Set an attribute only if the item lacks it; false when it had one. */
  async function setIfAbsent(pk, attr, value) {
    try {
      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk },
          UpdateExpression: "SET #a = :v",
          ConditionExpression:
            "attribute_exists(pk) AND attribute_not_exists(#a)",
          ExpressionAttributeNames: { "#a": attr },
          ExpressionAttributeValues: { ":v": value },
        }),
      );
      return true;
    } catch (e) {
      if (e?.name === "ConditionalCheckFailedException") return false;
      throw e;
    }
  }
  return ledgerOver({
    put,
    get,
    listByPrefix,
    listByPartition,
    increment,
    setIfAbsent,
    claimDay,
    remove: (pk) =>
      doc.send(new DeleteCommand({ TableName: tableName, Key: { pk } })),
  });
}
