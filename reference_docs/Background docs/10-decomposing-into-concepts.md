# How to decompose into concepts

Source: [How to decompose into concepts](https://61040.github.io/fa26/background/decomposing-into-concepts/)  
Downloaded: October 5, 2026

This document explains why you should decompose functionality into multiple concepts, and how to do it.

## Disentangling functionality

You're designing a software system, agentic workflow or organizational process. That means designing a *behavior*, or thinking in terms of the value you get from it, some *functionality*. You could represent the entire behavior or functionality in a single concept, as one complicated course of action. But it's better to break it into multiple, smaller concepts than are then composed. Sometimes this is relatively easy to do, but sometimes you have to work harder to disentangle different strands of behavior that belong in separate concepts but initially seemed to be part of the same behavior.

Here is what is gained by decomposing into multiple concepts:

- **Simplification**. Smaller and more focused concepts whose behavior is well aligned with a compelling purpose are easier to understand than one big concept.
- **Familiarity**. Concepts that designers and users already know and are familiar with are easier to understand than new concepts.
- **Reuse**. By factoring out concepts that can be reused in other contexts, you save later work.
- **Alignment of shared concepts**. When different members of a product family, or different groups within an organization, use different variants of the same concept, confusion arises and unnecessary work is done to reimplement the same basic idea multiple times, and to reconcile needless differences. This can be avoided by identifying shared concepts, but will often call for decomposing a more complicated behavior to find the shared one.
- **Ease of change**. A decomposition into robust concepts, each with its own clear purpose and behavior that fulfills it, makes it easier to localize evolution. When a change to behavior is needed, it's clearer where to make the change, and the change can be made in a smaller context.
- **Reliability of execution**. Coherent and focused concepts are executed more reliably because they are easier to understand than large and unfocused ones. For a concept that defines a policy, this means it's easier for people to understand and follow it. For a concept implemented in code, this means it's easier for an LLM to generate the code reliably and without bloat or bugs.

Of course these advantages are only obtained if you decompose a complicated behavior into the *right* concepts. If the concepts are arbitrary and incoherent, the result can be even worse than having one big complicated concept.

## How concepts fit together

Before learning how to do a concept decomposition, you need to understand how concepts fit together.

### Interleavings of action histories

A concept offers a *course of action*, and is defined by its *behavior*. This behavior comprises the collection of all possible scenarios or *traces*, each trace being some sequence of action occurrences.

An action can be performed by a human, an agent or a machine; when a concept is realized as a software service, some of the actions will become API functions that are called and others are executed spontaneously by the service.

When concepts are composed, every trace is just an interleaving of the traces of the individual concepts. So if you took the trace of all action occurrences, and filtered it to include only the actions of a given concept, you would obtain a trace of that concept. In other words, composition *preserves* the behavior of the individual concepts.

### Example of interleaving

Consider a social media app that includes a Posting concept with actions for creating, editing and deleting a post, and Commenting concept with actions for adding a comment to a post and removing it. The Posting concept allows its actions to happen in any order so long as a post is deleted only after it was created, and is edited only after being created and before being deleted. The Commenting concept likewise allows adding and removing comments, but removing only after adding.

So a trace of Posting is

> create ("helo"): (post1)
> edit (post1, "hello")
> delete (post1)

in which post1 is created with the contents "helo", edited to fix the typo, and then deleted. And a trace of Commenting is

> add (post1, "nice"): (comment1)
> remove (comment1)

in which comment1 is added to post1 and then removed.

Composing these two concepts results in a system whose traces can interleave these in any way. In this interleaving, for example, the comment is added after the post is edited, and removed after the post is deleted:

> create ("helo"): (post1)
> edit (post1, "hello")
> add (post1, "nice"): (comment1)
> delete (post1)
> remove (comment1)

and in this trace the comment is added after the post is created and removed before the post is edited:

> create ("helo"): (post1)
> add (post1, "nice"): (comment1)
> remove (comment1)
> edit (post1, "hello")
> delete (post1)

Some interleavings will not make sense: for example, adding a comment to a post after it has been deleted. Such interleavings will be ruled out with reactions.

### The role of states in concept composition

A concept has *state* that remembers which actions have been performed. In theory, states aren't necessary, and a concept's behavior is defined by its traces -- the actions that happened. But states are useful in practice for several reasons:

- **Defining behavior**. States give you a way to define the traces implicitly, without having to enumerate them all (which would generally be impossible since there's usually an infinite number of them).
- **Reacting on state**. When concepts are composed together with reactions, the reactions can refer to concept states to decide how actions in one concept are constrained by actions in another.
- **Visible states**. In some realizations of concepts, the states are visible to users, and provide useful information about which actions have happened.

### Coordinating concepts with reactions

When concepts are composed, not every interleaving is usually allowed. Instead, you specify some *reactions*, which are rules that constrain occurrences of actions between concepts.

Reactions play many roles in a design, such as:

- **Maintaining invariants**, for example by cascading deletes
- **Enforcing access controls**, by causing actions to occur only when permitted
- **Automating follow-up actions**, for example sending notifications

Often the reactions of a system embody the more domain-specific properties, allowing the concepts themselves to remain more general, so they can be reused more widely.

A reaction has the form:

- **when** some action occurs (in some concept)
- **where** some condition holds (on the state of one or more concepts)
- **then** one or more additional actions should occur.

## Suppressing actions and request actions

A reaction can't suppress the occurrence of an action; it only causes actions to happen. Instead, you want to prevent some action from occurring, you treat it as inaccessible to the outside world, and activated only by reactions. A reaction can then link occurrence of that action to a *request action* that represents a request coming in, and not firing the action in response to the request is tantamount to suppressing it.

### Examples of reactions: deleting posts

To illustrate reactions, let's return to the social media example with Posting and Commenting. We'll need some requesting actions which we'll think of as belonging to a Requesting concept that represents the course of action involved in making web requests and getting responses.

This reaction says that **when** an editPost request happens for a particular user and post, with some new content for that post, **where** the user is the author of the post, **then** the edit action happens:

> **when** Requesting.editPost (user, post, newContent)
> **where** Posting: user is author of post
> **then** Posting.edit (post, newContent)

Note that if the user is not the author of the specified post, then the follow up action will not occur. The where clause queries the state of the Posting concept to find the post's author; this will be the user who previously created the post.

What should happen when a post is deleted that might have comments associated with it? These three designs define three different ways to handle this problem. In the first, the request to delete a post only leads to it being deleted if there is no comment on it (and the user deleting the post is its author):

> **when** Requesting.deletePost (user, post)
> **where** Posting: user is author of post
> **and** Commenting: post is not a target of a comment
> **then** Posting.delete (post)

In the second, the post is deleted if the user is the author, and any comment associated with it is deleted too in a second reaction:

> **when** Requesting.deletePost (user, post)
> **where** Posting: user is author of post
> **then** Posting.delete (post)

> **when** Posting.delete (post)
> **where** Commenting: post is a target of comment
> **then** Commenting.remove (comment)

In the third, if the post has a comment, it is not actually deleted but the post is edited to say "deleted":

> **when** Requesting.deletePost (user, post)
> **where** Commenting: post is a target of comment
> **then** Posting.edit (post, "deleted")

This last reaction might be combined with the first above to cause a regular deletion when there is no comment.

## How concepts enforce independence

When designing with concepts, it's vital to understand that concepts achieve a degree of modularity that is unusual in software systems. This means that concepts are, by construction, always fully independent of one another. But it also means that the kinds of escape hatches that allow you to fudge things in traditional designs aren't available, so you really need to design carefully.

Here are the key ways in which concept independence is ensured:

- **No calls**. The actions of one concept cannot "call" the actions of another concept; the only way data or control can flow between concepts is through reactions.
- **No shared state**. The state of each concept is accessible only to that concept. That is, it is updated by the actions of the concept, and used to determine whether an action can happen. A software implementation of a concept can make the state queries that reactions use in their where clauses available as query functions. A concept's query functions can access only the concept's state, and not the state of another concept.
- **No mutable objects passed**. In object-oriented systems, state can be shared in a rather subtle and complicated way: by passing a mutable object that is mutated in one place and queried in another. Concept design has no such objects. When an individual is passed as an input or output of an action, only the identity of the individual is passed. Structured data can be passed as values, but values are not mutable.
- **No constraints on other concepts' types**. When one concept accepts individuals in its actions that are created by other concepts, it cannot make an assumptions whatsoever about those individuals. For example, if an Authenticating concept creates user individuals, and a reaction passes a user to an action of a Posting concept as the author of a post, the Posting concept is not entitled to assume that a user has a name, even if the Authenticating concept does associate users and their names in its state. If you want to think about this in type theoretic terms, the Posting concept is polymorphic in the type of Author, which is a parameter rather than a concrete type. That Author type parameter might be bound to the type of user generated by Authenticating in one system, but in another it might be bound to a different type. This allows concepts to be applied more generally: a Commenting concept, for example, would treat the target of comments as such a parameter, so that the same concept could be used to comment on posts, or on articles, or even on users.

## How to decompose

Now we get to the central question: how to decompose a behavior into concepts. A variety of strategies can be applied:

- **Recognizing familiar concepts**. The first step is to consider whether the behavior embodies some familiar concepts. If so, they become the first candidate concepts. In some situations, you might even find that most or almost all of the concepts are familiar ones. If you were building a social media app or a task tracker or an online forum, for example, you'd expect most of the concepts to be ones that you've seen already. A familiar concept may not apply exactly, but you may be able to adjust it to fit by making small changes. Just bear in mind that usually adjustments in behavior are better achieved in reactions, leaving the concepts as conventional as possible.
- **Analyzing proposed concepts**. Assuming that the familiar concepts have now been factored out, only novel concepts remain. These can now be analyzed in turn, using criteria laid out below, which might suggest breaking a concept into smaller concepts or coalescing two concepts into one.
- **Simplifying reactions**. When you come to compose your concepts by specifying the reactions that constrain their interleavings, the clarity and simplicity of your reactions will follow from the quality of the concepts. Inadequacies in concepts (for example, not having a rich enough state) can result in needlessly complicated reactions. So checking the reactions and thinking about how they might be simplified by changing the concepts is a useful feedback loop.
