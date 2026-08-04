---
layout: home

hero:
  name: Keyway
  text: A NoSQL data modeling tool
  tagline: Design and learn DynamoDB data modeling as plain text, then watch it work, all in your browser.
  image:
    src: /demo.gif
    alt: Keyway in action - typing a DynamoDB model as text and watching it project into the base table and indexes, with per-write cost
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
    details: Declare what your design must serve, and Keyway runs each query to grade what is covered.
  - title: Learn by watching
    details: Guided, narrated tours step through real models, from the editor basics to conditional writes.
  - title: Private by default
    details: Everything runs client-side. Your model never leaves the browser tab.
---
