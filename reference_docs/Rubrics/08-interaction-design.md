# Rubric for interaction design

Source: [Rubric for interaction design](https://61040.github.io/fa26/rubrics/interaction-design/)

Downloaded: October 20, 2026

## Some qualities of good interaction design

**Understandable.** Users should be able to figure out what the app does and how to use it. Names and controls should help them understand the app’s concepts, without having to know how you implemented them.

**Directed toward the task.** The interface should help users accomplish what they came to do. Actions that belong together should be available together, and common tasks should not require unnecessary steps. A user should not have to navigate your concept structure just because that is how the code is organized.

**Informative.** Users should be able to tell what state the app is in and what happened after an action. If they submit something, was it accepted? If an operation takes time, is it still running? If an action is unavailable, can they tell why?

**Consistent.** Similar actions should be presented and behave similarly. Use familiar conventions where they apply, so that users can bring what they already know to your app.

**Forgiving.** Consider what happens when users make mistakes. Help them avoid consequential errors and recover when something goes wrong. An error message should explain what they can do next; it should not leave them at a dead end or require them to start over unnecessarily.

## Some pitfalls

**An interface to the implementation.** Each concept has its own page and each action has its own button, but completing a task requires the user to piece these together. The organization makes sense to the programmer, but not to someone trying to use the app.

**Hidden prerequisites.** An action requires something the user has not yet done, but the interface gives no indication of this. For example, a user can begin creating an event, only to discover at the end that they first needed to create a group elsewhere.

**Unexplained consequences.** A label such as “Done” does not tell the user whether they are saving a draft, publishing it, or simply closing the window. The user has to try the action to find out.

**Only the happy path.** The interaction is easy to follow when everything goes as expected, but becomes confusing when a list is empty, an input is invalid, or an operation fails.

## Competency levels

**Deficient.** Users cannot determine how to complete important tasks, or the interface gives misleading indications of what actions will do and what has happened.

**Emergent.** The main tasks can be completed, but users must guess, remember information unnecessarily, or learn through mistakes. The interface makes sense once someone explains it, but does not provide enough help on its own.

**Competent.** Users can understand and complete the main tasks without an explanation from the designer. Actions and their consequences are clear, feedback keeps users informed, and foreseeable mistakes can be corrected. Some interactions may still be awkward or take more effort than necessary.

**Expert.** The design makes a potentially confusing task feel straightforward. Information and actions are available when users need them, and the interface helps them understand what they are doing as they do it. Someone watching the interaction can see how the design has removed a difficulty that would otherwise have fallen to the user.
