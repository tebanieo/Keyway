import { DEFAULT_DOC } from "./doc";

/**
 * Curated DynamoDB data models. Each is plain DSL text loaded through the same
 * loadModel() path a shared link uses. Open-source contributors add an example
 * by appending one entry here (or a file they import). Every example doubles as
 * a steppable, cost-annotated teaching artifact for a classic pattern.
 */
export interface Example {
  name: string;
  description: string;
  dsl: string;
}

const SAAS = `# Multi-tenant SaaS - tenants, users, and projects, all scoped by tenant.
# Heads-up: scoping every item under one per-tenant PK (TENANT#acme) is simple,
# but a large or busy tenant makes that partition hot. In production, shard the
# key (e.g. TENANT#acme#<n>) or give hot entities their own partitions.
@table SaasTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK

@ap List a tenant's users -> SaasTable PK=TENANT#acme SK begins_with USER#
@ap Find a user by email -> GSI1 GSI1PK=EMAIL#ada@acme.com
@ap List a tenant's active projects -> GSI1 GSI1PK=STATUS#active

t1: PK=TENANT#acme  SK=META  name=Acme Corp  plan=enterprise  _type=tenant
u1: PK=TENANT#acme  SK=USER#ada  name=Ada  email=ada@acme.com  role=admin  GSI1PK=EMAIL#ada@acme.com  GSI1SK=TENANT#acme  _type=user
u2: PK=TENANT#acme  SK=USER#bob  name=Bob  email=bob@acme.com  role=member  GSI1PK=EMAIL#bob@acme.com  GSI1SK=TENANT#acme  _type=user
p1: PK=TENANT#acme  SK=PROJECT#apollo  name=Apollo  status=active  GSI1PK=STATUS#active  GSI1SK=2024-03-01  _type=project
p2: PK=TENANT#acme  SK=PROJECT#gemini  name=Gemini  status=archived  GSI1PK=STATUS#archived  GSI1SK=2023-11-20  _type=project
`;

const SOCIAL = `# Social graph - profiles, follows (adjacency-list edges), and posts.
@table SocialTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK

@ap Get a profile -> SocialTable get PK=USER#ada SK=PROFILE
@ap Who follows a user -> GSI1 GSI1PK=USER#alan GSI1SK begins_with FOLLOWER#
@ap A user's feed, newest first -> GSI1 GSI1PK=FEED#ada

a1: PK=USER#ada  SK=PROFILE  handle=ada  name=Ada Lovelace  _type=profile
a2: PK=USER#alan  SK=PROFILE  handle=alan  name=Alan Turing  _type=profile

# an edge: ada follows alan. GSI1 flips it so you can query alan's followers.
f1: PK=USER#ada  SK=FOLLOWS#alan  since=2024-01-10  GSI1PK=USER#alan  GSI1SK=FOLLOWER#ada  _type=follow

p1: PK=USER#ada  SK=POST#2024-03-02  text=Hello world  GSI1PK=FEED#ada  GSI1SK=2024-03-02  _type=post
p2: PK=USER#ada  SK=POST#2024-03-05  text=Second post  GSI1PK=FEED#ada  GSI1SK=2024-03-05  _type=post
`;

const MULTIKEY = `# Native multi-key GSI - up to 4 partition + 4 sort attributes as SEPARATE,
# natively-typed columns (no string concatenation). "ByRegion" partitions by
# (tenant, region) and sorts by (status, date). In a query, all partition attrs
# are equality; of the sort attrs only the LAST (date) can take a range.
@table OrdersTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK
@gsi ByRegion pk=tenant,region sk=status,date

@ap Get an order by id -> OrdersTable get PK=ORDER#1 SK=META
@ap Open orders for a tenant + region -> ByRegion tenant=acme region=us status=open

o1: PK=ORDER#1  SK=META  tenant=acme  region=us  status=open  date=2024-03-01  total=42  _type=order
o2: PK=ORDER#2  SK=META  tenant=acme  region=us  status=shipped  date=2024-02-10  total=17  _type=order
o3: PK=ORDER#3  SK=META  tenant=acme  region=eu  status=open  date=2024-03-05  total=88  _type=order
o4: PK=ORDER#4  SK=META  tenant=globex  region=us  status=open  date=2024-01-20  total=5  _type=order
`;

export const EXAMPLES: Example[] = [
  {
    name: "Users & orders",
    description: "the guided tour - GSI overloading, a sparse index, a reindex on ship",
    dsl: DEFAULT_DOC,
  },
  {
    name: "Multi-tenant SaaS",
    description: "tenants, users, projects - everything scoped per tenant",
    dsl: SAAS,
  },
  {
    name: "Social feed",
    description: "profiles, follows as adjacency edges, a reverse-lookup GSI",
    dsl: SOCIAL,
  },
  {
    name: "Multi-key GSI",
    description: "native composite keys - partition by (tenant, region), sort by (status, date)",
    dsl: MULTIKEY,
  },
];
