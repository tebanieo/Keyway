---
layout: home

hero:
  name: Keyway
  text: Learn AWS DynamoDB data modelling by typing it
  tagline: Write your model as a short script and watch tables, GSIs, write costs and access-pattern coverage update live as you type. 100% client-side and private.
  image:
    src: /demo.gif
    alt: Keyway in action - typing a model with a key template, generating sample customers and orders with @gen, then replaying every write with its cost
  actions:
    - theme: brand
      text: Open the app
      link: https://tebanieo.github.io/Keyway/
    - theme: alt
      text: Quick start
      link: /introduction#quick-start
    - theme: alt
      text: The DSL
      link: /dsl

features:
  - title: The text is the model
    details: A tiny, readable DSL is the whole artifact. No schema files, no database to connect to.
  - title: Watch it project
    details: Every write updates the base table and each secondary index live, with a diff of what moved.
  - title: See the cost
    details: Each write shows its estimated capacity, so a reindex visibly costs more than a plain update.
  - title: Check your access patterns
    details: Declare what your design must serve with @ap, and Keyway runs each query; every @ap line shows ✓ when it's served, or why not.
  - title: Fast to fill, easy to change
    details: Build an entity's keys from its attributes once with @key, and ask for sample rows with @gen project 3 per tenant, then Tab.
  - title: Keyboard-first
    details: Completions, a command palette (Ctrl/Cmd+K) and shortcuts; editing a cell in the tables writes into the script.
  - title: Learn by watching
    details: Guided, narrated tours step through real models, from the editor basics and sample data to conditional writes.
  - title: Private by default
    details: Everything runs client-side. Your model never leaves the browser tab.
---
