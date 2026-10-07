# What a concept is and is not

Source: [What a concept is and is not](https://61040.github.io/fa26/background/what-a-concept-is/)  
Downloaded: October 5, 2026

## What a concept is

In concept design, the term "concept" has a particular meaning:

- **A concept is a behavior...** : A behavior is a collection of possible action sequences. For example, the behavior of an Authenticating concept might include the action sequence in which a user registers with a user name and password, authenticates, changes their password, authenticates again, and so on. There are generally an infinite number of possible action sequences. For Authenticating, for example, there are different action occurrences for each user and password, different interleavings of multiple users, and different action choices that each user makes.
- **... With a purpose**: Not any behavior makes a concept; the behavior has to be in support of a purpose. The purpose of Authenticating, for example, is to identify users and to prevent one user from masquerading as another.

Following from this meaning are some of the roles that a concept plays:

- **A concept is a service**. When a concept is implemented in software, it becomes a service in which the actions are API calls that update the internal state of the service. The service might provide queries which are functions that report, based on the concept state, which facts hold at a given point.
- **A concept is a social protocol**. A concept often defines a protocol that human users engage in. For example, the Inviting concept dictates how one user invites another user to an event, and then accept or decline, and then attend or not (usually adhering to the rule that accepting doesn't strictly require attending, but declining prohibits it).
- **A concept is a policy**. As a human protocol, a concept can be imposed on the members of a society or organization. For example, the ways in which a company requires employees to file expense reports, get approval for certain expenditures in advance, and meet certain rules about spending money on clients are all concepts.
- **A concept is an invention**. All concepts, even those that are familiar social protocols, are inventions. The substance of the invention is the behavior, not its particular realization in any given technology. For example, the Reserving concept used by restaurants was invented in the 19th century, even before the telephone, and its implementation at the time relied only on a physical book recording reservations.
- **A concept is a differentiator**. A software product can be viewed as a collection of concepts, some of which existed previously and some of which were specific to the product. Some concepts are differentiators that make the product successful and distinguish it from other products. For example, the Layering concept of Adobe Photoshop, which allowed non-destructive editing, gave Photoshop a critical advantage over its competitors and established it as the leading photo editing application.
- **A concept is an asset**. A concept can be a valuable asset to an organization because it represents a shared and well-developed understanding of a behavior that brings repeated value. For example, a company might have ways to deploy and evolve marketing funnels that give them a competitive advantage and that are familiar to everyone who works on them.
- **A concept is a locus for design**. The design of any complex system -- whether a software system, an agentic AI deployment, an organizational policy -- evolves over time, and requires the participation of multiple stakeholders. A repository of concepts can serve as a shared space for work and discussions, and the division into concepts provides a locus for each particular concern and the evolving design work that addresses it.
- **A concept is a pattern**. A concept is a design pattern in Christopher Alexander's sense: a stable design element that has stood the test of time, brings known value, and has well documented limitations. For example, the concept of Upvoting, in which users upvote or downvote items, and the aggregate votes determine ranking of items, is used in almost all social media applications.
- **A concept is a chunk**. Psychologists have noted that experts "chunk" phenomena into larger units. A soloist performing a concerto by heart, for example, does not think of the score as a sequence of notes, which would make it impossible to learn, but instead uses chunking to view it in terms of bars, motifs, themes, and so on. Similarly, concepts provide mental chunks for behavioral design. For example, a web app designer who tells another that they plan to use Authenticating with Sessioning does not need to explain what these concepts are or how they work.
- **A concept is a mental model**. For users of a system, the system's concepts provide a mental model of how the system behaves and how to interact with it. For example, when the Apple Lisa computer came out in 1983, users needed to learn the concept of Trashing to understand how to use the trash bin: that deleting an item placed it in the trash, and you could then restore it, but once you empty the trash, its contents are gone.

## What a concept is not

Some common usages of the word "concept" are misleading and represent something different:

- **Not a classification**. In concept lattices, a concept is a classification of things in the world. The concept of dog, for example, classifies animals and distinguishes them according to certain features (four legs, fur, etc). A dog is not a concept in concept design.
- **Not a philosophical idea**. In philosophy, a concept can mean an idea or a collection of related ideas. For example, the concept of solipsism is the idea that only your own mind is sure to exist. Solipsism is not a concept in concept design.
- **Not an entity**. In entity-relationship modeling, entities and their associated attributes are sometimes referred to as concepts. For example, in a restaurant reservation system, the Reservation entity that holds a time, a restaurant and a diner's name may be referred to as a concept. In concept design, an entity is not a concept (although it may be part of the state of a concept).
