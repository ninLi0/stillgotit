# Rubric for concept design

Source: [Rubric for concept design](https://61040.github.io/fa26/rubrics/concept-design/)  
Downloaded: October 6, 2026

A good concept design should have these qualities:

- **Purpose.** Each concept has a clear purpose and an operational principle that explains how its behavior fulfills that purpose.
- **Independence.** Concepts separate concerns. A concept’s state and action definitions do not refer to another concept’s state or actions, and external objects are represented using generic types. Its purpose and operational principle may describe surrounding activity involving other concepts.
- **Precision.** State and action specifications are complete enough to explain the intended behavior, including relevant conditions and effects.
- **Composition.** Essential reactions explain how the concepts work together to deliver the application’s features. They use the composition conventions introduced in class and separate independent linkages.

Common pitfalls:

- **Data structures instead of concepts.** A concept names a collection of data but has no meaningful behavior or purpose.
- **Hidden dependencies.** A concept assumes details of another concept, or a reaction disguises an imperative script.
- **Missing behavior.** The specifications or reactions omit an essential part of the proposed application, leaving the reader to invent how it works.
- **Unnecessary complexity.** Extra concepts, actions, or reactions make the design harder to understand without improving its ability to address the problem.

Competency levels:

- **Deficient.** The design does not establish intelligible concepts or explain how they deliver the proposed functionality. Essential specifications or composition rules are absent.
- **Emergent.** Some concepts have clear purposes and plausible behavior, but important concerns are conflated, specifications are incomplete, or the reactions leave significant gaps in how the application works.
- **Competent.** Concepts are purposeful, independent, and precisely specified. The essential reactions make their composition understandable and support the proposed functionality. The design is coherent and appropriately scoped.
- **Expert.** The design meets the competent criteria and reveals an insightful decomposition or composition that makes a difficult part of the problem simpler. The choice of responsibilities and behavior makes the design simpler and clearer.

See the background documents on [defining a concept](https://61040.github.io/fa26/background/defining-concepts/), [specifying a concept](https://61040.github.io/fa26/background/specifying-concepts/), and [specifying concept state](https://61040.github.io/fa26/background/specifying-concept-state/).
