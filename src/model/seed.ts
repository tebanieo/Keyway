import type { IndexSpec, Op } from "../engine/types";

/**
 * The base table and one overloaded GSI. GSI1 is reused across entity types:
 * PROFILE rows index by email, ORDER rows index by status. That overloading is
 * the whole point of single-table design — and the thing a viewer has to make
 * legible.
 */
export const BASE_INDEX: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
export const GSI1_INDEX: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };
export const INDEXES = [BASE_INDEX, GSI1_INDEX];

/**
 * A hand-authored op log that reads as a story when stepped:
 *   1-2  two users sign up (PROFILE rows, indexed by email on GSI1)
 *   3    user 1 sets notification prefs (SETTINGS row — NOT on GSI1, sparse)
 *   4-6  orders are placed (ORDER rows, indexed by status on GSI1)
 *   7    an order ships — an UPDATE that moves it across GSI1 partitions
 *   8    a user cancels an order — a DELETE
 *
 * Each op mutates only a couple of items, so the delta stays small no matter
 * how big the model grows.
 */
export const SEED_OPS: Op[] = [
  {
    kind: "put",
    item: {
      id: "u1",
      attrs: {
        PK: "USER#1",
        SK: "PROFILE",
        name: "Ada Lovelace",
        email: "ada@analytical.io",
        GSI1PK: "EMAIL#ada@analytical.io",
        GSI1SK: "USER#1",
      },
    },
  },
  {
    kind: "put",
    item: {
      id: "u2",
      attrs: {
        PK: "USER#2",
        SK: "PROFILE",
        name: "Alan Turing",
        email: "alan@enigma.uk",
        GSI1PK: "EMAIL#alan@enigma.uk",
        GSI1SK: "USER#2",
      },
    },
  },
  {
    // Settings carry no GSI1 keys, so they live in the base table but never
    // reach GSI1 — a sparse index in action. Side-by-side, this row is present
    // on the left and simply absent on the right.
    kind: "put",
    item: {
      id: "s1",
      attrs: {
        PK: "USER#1",
        SK: "SETTINGS#notif",
        channel: "email",
        frequency: "daily",
      },
    },
  },
  {
    kind: "put",
    item: {
      id: "o1",
      attrs: {
        PK: "USER#1",
        SK: "ORDER#2024-01",
        total: "42.00",
        status: "pending",
        GSI1PK: "STATUS#pending",
        GSI1SK: "2024-01-14",
      },
    },
  },
  {
    kind: "put",
    item: {
      id: "o2",
      attrs: {
        PK: "USER#1",
        SK: "ORDER#2024-02",
        total: "17.50",
        status: "pending",
        GSI1PK: "STATUS#pending",
        GSI1SK: "2024-02-03",
      },
    },
  },
  {
    kind: "put",
    item: {
      id: "o3",
      attrs: {
        PK: "USER#2",
        SK: "ORDER#2024-03",
        total: "99.99",
        status: "pending",
        GSI1PK: "STATUS#pending",
        GSI1SK: "2024-03-21",
      },
    },
  },
  {
    // order o1 ships: same base key (overwrite), but GSI1PK changes, so on the
    // GSI1 view this item hops from the STATUS#pending partition to STATUS#shipped
    kind: "put",
    item: {
      id: "o1",
      attrs: {
        PK: "USER#1",
        SK: "ORDER#2024-01",
        total: "42.00",
        status: "shipped",
        GSI1PK: "STATUS#shipped",
        GSI1SK: "2024-01-14",
      },
    },
  },
  { kind: "delete", id: "o2" },
];
