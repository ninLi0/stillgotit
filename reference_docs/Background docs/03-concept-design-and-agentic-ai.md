# Concept design and agentic AI

Source: [Concept design and agentic AI](https://61040.github.io/fa26/background/concept-design-and-agentic-ai/)  
Downloaded: October 5, 2026

## What the problems are

Agentic AI is about designing and deploying agents that work within an existing organizational context. The problem isn't implementing (or even scaling) the agents, but deciding what they should do.

- **Documenting existing workflows**. More inserting an agent into an existing workflow, you need to know what that workflow is and where it could be improved: what the points of failure are; where delays accumulate due to dependencies; where human judgment is required and where it isn't.
- **Designing behaviors**. If an agent enacts the wrong behavior, no amount of intelligence will save it. When an organization deploys an agent, it must first have figured out what the agent will do. Of course this doesn't mean pinning down the choices the agent will make in every situation. Rather it means knowing what behaviors are possible, and constraining them to ensure the best outcomes.
- **Balancing agentic, human and machine behavior**. In any agentic system, some steps are taken by humans, some by agents and some by conventional machines. Getting this balance right is essential. Roughly, costly and tedious steps that require inference should be assigned to agents; steps that require insight, human empathy or strategic wisdom should be assigned to humans; and steps that can executed deterministically should be assigned to machines.
- **Integrating behaviors**. When multiple agents work together, they must be instructed to react appropriately to the behavior of other agents. This means that they need to know what behaviors are possible for other agents and how they should respond to them.
- **Filling critical gaps**. An AI agent will fill in any gaps in instructions that you provide. Sometimes they do this very effectively. But the risk is that if you leave a gap it will be filled in an unexpected and incorrect way.
- **Getting details right**. A common pattern in software development is that a high- level lead outlines the functionality, and then as tasks pass through different roles, the details are filled in. When the details matter, this can be disastrous, resulting in behavior that was not only not anticipated by the lead but is actually not understood by anyone, since nobody was responsible for all the details.
- **Losing control**. Due to all these problems, those who are accountable for agents lose control over them: other people (and agents) design behaviors, fill critical gaps, and sort out the details. The result is that the lead who is accountable neither controls the outcome nor has visibility into it.

## How concept design addresses these problems

Concept design addresses these problems by making behavior explicit.

- **Concepts allow anyone to read and write behaviors**. The language of concept design is accessible to all roles in an organization, including those without technical background. With concept design, everyone involved can start with a clear understanding of what the existing workflows are and what changes are proposed.
- **Concepts allow anyone to design behaviors**. Concept designs focus on the desired behavior and not the engineering details of how that behavior is achieved. Anyone who understands workflows can design agentic behaviors.
- **Concepts enforce courses of action**. In a concept-designed workflow, an agent is not given tools that offer arbitrary access to all APIs, but instead gets to execute prescribed concept actions, thus ensuring that agent behavior conforms to the expected courses of action defined by concepts. Concepts thus offer "guiderails" in which behavior conforms to expected constraints by design, rather than "guardrails" that attempt to preempt and prevent everything that might go wrong in an ad hoc way.
- **Concepts factor out deterministic code**. Using concept reactions, a concept-designed workflow can easily assign steps to a machine so that they are executed entirely reliably. For example, if an agent determines who is to be invited to a meeting (using an Inviting concept), a reaction can ensure that each participant is notified (by synchronizing actions of Inviting with actions of a Notifying concept).
- **Concepts embody standard agentic patterns**. Standard patterns for AI-human interaction can be easily expressed using concepts and reactions between them. For example, an Approving concept can govern a workflow in which actions are proposed by an agent and approved by a human; a Delegating concept can manage delegating tasks to humans or agents depending on their complexity; an Authorizing concept can block agentic actions that are not authorized (for example, accessing someone else's bank account).
- **Concepts enable LLMs**. Because concepts have a well defined form and meaning, they can be analyzed, simulated and implemented straightforwardly by AI agents themselves. You can specify your concept once, and have it automatically translated into different forms for different audiences.
  The result is:
- **Streamlined agentic development**. All parties involved in deploying agents are aligned on the problems, design options and deployed solutions. The solutions address the problems that motivated them and there is a clear arc of traceability from problem to solution.
- **Exploiting inference while maximizing safety**. By ensuring conformance to prescribed courses of action, by reliably incorporating deterministic steps, and by enforcing approvals and checks etc, a concept-designed workflow enables you to exploit LLM inference while maximizing safety.
- **Control and visibility for those accountable**. The lead who commissions an agent can specify clearly the essential details of the behavior they want rather than just conveying only a vague impression and then discovering that what gets delivered is not what they had in mind. They maintain control, ensuring that their vision is realized, and visibility, so they can see what is happening along the way and be confident in the solution.
