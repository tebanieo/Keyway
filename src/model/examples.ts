import { DEFAULT_DOC } from "./doc";

/**
 * Curated single-table models. Each is plain DSL text loaded through the same
 * loadModel() path a shared link uses. Open-source contributors add an example
 * by appending one entry here (or a file they import). Every example doubles as
 * a steppable, cost-annotated teaching artifact for a classic pattern.
 */
export interface Example {
  name: string;
  description: string;
  dsl: string;
}

const SAAS = `# Multi-tenant SaaS — tenants, users, and projects, all scoped by tenant.
# Access patterns:
#   - list a tenant's users        (base: PK=TENANT#x, SK begins_with USER#)
#   - find a user by email         (GSI1: EMAIL#...)
#   - list a tenant's projects by status  (GSI1 overloaded: STATUS#...)
@gsi GSI1 pk=GSI1PK sk=GSI1SK

t1: PK=TENANT#acme  SK=META  name=Acme Corp  plan=enterprise  _type=tenant
u1: PK=TENANT#acme  SK=USER#ada  name=Ada  email=ada@acme.com  role=admin  GSI1PK=EMAIL#ada@acme.com  GSI1SK=TENANT#acme  _type=user
u2: PK=TENANT#acme  SK=USER#bob  name=Bob  email=bob@acme.com  role=member  GSI1PK=EMAIL#bob@acme.com  GSI1SK=TENANT#acme  _type=user
p1: PK=TENANT#acme  SK=PROJECT#apollo  name=Apollo  status=active  GSI1PK=STATUS#active  GSI1SK=2024-03-01  _type=project
p2: PK=TENANT#acme  SK=PROJECT#gemini  name=Gemini  status=archived  GSI1PK=STATUS#archived  GSI1SK=2023-11-20  _type=project
`;

const SOCIAL = `# Social graph — profiles, follows (adjacency-list edges), and posts.
# Access patterns:
#   - get a profile
#   - who follows a user   (GSI1 reverses the follow edge)
#   - a user's feed, newest first  (GSI1: FEED#user)
@gsi GSI1 pk=GSI1PK sk=GSI1SK

a1: PK=USER#ada  SK=PROFILE  handle=ada  name=Ada Lovelace  _type=profile
a2: PK=USER#alan  SK=PROFILE  handle=alan  name=Alan Turing  _type=profile

# an edge: ada follows alan. GSI1 flips it so you can query alan's followers.
f1: PK=USER#ada  SK=FOLLOWS#alan  since=2024-01-10  GSI1PK=USER#alan  GSI1SK=FOLLOWER#ada  _type=follow

p1: PK=USER#ada  SK=POST#2024-03-02  text=Hello world  GSI1PK=FEED#ada  GSI1SK=2024-03-02  _type=post
p2: PK=USER#ada  SK=POST#2024-03-05  text=Second post  GSI1PK=FEED#ada  GSI1SK=2024-03-05  _type=post
`;

const EVENTS = `# Event ticketing — events, and tickets scoped to an event.
# Access patterns:
#   - get an event
#   - list an event's tickets by tier  (base: SK begins_with TICKET#)
#   - find tickets held by a person    (GSI1: HOLDER#email)
@gsi GSI1 pk=GSI1PK sk=GSI1SK

e1: PK=EVENT#reinvent  SK=META  name=re:Invent  date=2024-12-02  city=Las Vegas  _type=event
k1: PK=EVENT#reinvent  SK=TICKET#0001  tier=vip  holder=ada@x.io  GSI1PK=HOLDER#ada@x.io  GSI1SK=EVENT#reinvent  _type=ticket
k2: PK=EVENT#reinvent  SK=TICKET#0002  tier=general  holder=bob@x.io  GSI1PK=HOLDER#bob@x.io  GSI1SK=EVENT#reinvent  _type=ticket
k3: PK=EVENT#reinvent  SK=TICKET#0003  tier=general  holder=ada@x.io  GSI1PK=HOLDER#ada@x.io  GSI1SK=EVENT#reinvent  _type=ticket
`;

export const EXAMPLES: Example[] = [
  {
    name: "Users & orders",
    description: "the guided tour — GSI overloading, a sparse index, a reindex on ship",
    dsl: DEFAULT_DOC,
  },
  {
    name: "Multi-tenant SaaS",
    description: "tenants, users, projects — everything scoped per tenant",
    dsl: SAAS,
  },
  {
    name: "Social feed",
    description: "profiles, follows as adjacency edges, a reverse-lookup GSI",
    dsl: SOCIAL,
  },
  {
    name: "Event ticketing",
    description: "events and tickets, plus find-by-holder on GSI1",
    dsl: EVENTS,
  },
];
