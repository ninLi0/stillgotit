# Rubric for implementing a concept-based application

Source: [Rubric for implementing a concept-based application](https://61040.github.io/fa26/rubrics/implementing-concepts/)

Downloaded: October 11, 2026

A good implementation should have these qualities:

- **Faithfulness.** The code and current specifications agree, and the implemented behavior fulfills the intended user journeys. Linked API documentation and generated contracts match the implemented requests and responses, including authentication where needed.
- **Modularity.** Concepts separate concerns and remain independent. Reactions coordinate them without duplicating rules throughout the front end or concept implementations. Front-end components cleanly separate concerns, with clear responsibilities for their state, data, and behavior.
- **Integration.** The front end, back end, and persistent data work together. Within the milestone’s scope, the app is fully reactive and requires no page refreshes. Where appropriate, client-side validation and error checking are performed; informative error messages are shown. Authentication and access control are enforced in the back end wherever the implemented functionality requires them.
- **Intentional development.** Design notes explain significant changes and the reasons for them. The design notes and Git history show how work progressed in increments and how changes, including agent-generated changes, were reviewed and checked before building on them.

Common pitfalls:

- **An appearance of functionality.** A demonstration relies on mock screens, manual data edits, or a path that avoids necessary behavior.
- **Broken boundaries.** Concepts call each other or read each other’s state, pass objects that expose another concept’s internals, or rely on front-end checks for access control.
- **Unexplained drift.** The code differs materially from its specifications, or design notes describe superficial changes while omitting important decisions.

Competency levels:

- **Deficient.** Essential behavior within the milestone’s scope does not work, or the implementation provides no coherent evidence of concept-based structure.
- **Emergent.** Some useful behavior works, but missing integration, inconsistent specifications, significant dependencies, or access-control gaps prevent the implementation from fulfilling its intended scope reliably.
- **Competent.** The required behavior works across the application without page refreshes, with appropriate validation and informative error messages. Specifications and linked API documentation match the code. Concepts and reactions preserve their intended boundaries, and front-end components separate concerns. Relevant access controls are enforced in the back end. Design notes and Git history explain significant changes and show how increments were checked.
- **Expert.** The implementation meets the competent criteria and demonstrates unusually good judgment in resolving a difficult integration or modularity issue. The code and design record show how a well-chosen refinement simplified the application or made its behavior more consistent without sacrificing its purpose.
