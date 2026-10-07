# Defining concepts

Source: [Defining concepts](https://61040.github.io/fa26/background/defining-concepts/)  
Downloaded: October 5, 2026

The outline of a concept, comprising its name, purpose and principle, can be enough to decide whether the concept is suitable for the task at hand. It provides a helpful summary of the concept that is sufficient for many uses. But to explore and evaluate a design more fully will require a *definition* of each concept.

## How concept definitions differ from concept outlines

The definition of a concept differs from its outline in the following respects:

- **Action details**. A concept definition sharpens the scenarios described in the principle by detailing the actions that are performed, by making explicit the individuals and values that characterize them.
- **Delineating responsibility**. The natural and intuitive way to write an informal principle can blur the line of responsibility between a concept and the other concepts in its environment. A concept definition delineates responsibility more precisely.
- **All scenarios**. A concept outline gives only a few archetypal scenarios in its principle. It doesn't tell you what kinds of interleavings or repetitions of actions are possible, or what other actions might occur. A concept definition defines the entire set of all possible scenarios, so that the possible scenarios are fully predictable.
- **Introducing state**. A concept definition introduces the notion of concept *state*: what the concept remembers over time. The state of a concept summarizes the actions that have occurred so far, and determines what actions are allowed to happen next.

## Detailing actions and delineating responsibility

**Actions in the principle**. To construct the action list, start by considering each of the steps in the principle and deciding if it should be an action of the concept. Not all the actions of a concept need be performed by the same actor. Some might be performed by a user, for example, or autonomously by the system in response to another action. In an agentic system, some actions will be performed by agents, some my standard deterministic machines, and some by users.

**Delineating responsibility**. Some steps in the principle may correspond to actions in *other* concepts, and are included only to provide context for the concept's principle. Hints that a step is not part of this concept include:

- You could imagine a separate concept with its own principle that governs that step and the lifecycle it belongs to.
- The step could be reified as a different kind of action depending on different contextual uses of this concept.
- The principle still makes sense without this concept having an action for this step.

**Additional actions**. Then consider adding further actions that do not correspond to steps in the principle, but which might be required for special cases or unhappy paths. For each action already defined, you can ask if there is a compensating action that might be needed to undo its effect.

**Defining each action**. Each action in the list should have a **name**, and some **named arguments**, divided into **inputs** (which are provided when the action is invoked) and **outputs** (which result from the action's execution). Defining these arguments is often trickier than you might expect, because it raises questions about the generality of the concept and the division of responsibility between concepts. One way to think about selecting arguments is to ask what would make two action occurrences distinguishable from one another: the arguments are qualifiers that make otherwise identical actions distinct.

## Kinds of arguments and individuals vs. values

**Kinds of arguments**. There are two kinds of argument: **individuals** and **values**.

- **Individuals**. An individual represents some entity with a persistent identity. It might be an actor or physical thing in the real world (such as a person, a company, a car), or it might be something virtual that is created by software (such as a restaurant reservation, or a paragraph style, or a digital photo). Just because an individual is virtual doesn't mean that it doesn't have physical representations, but it's important to distinguish the individual from those representations. For example, an airline ticket is a virtual entity representing the airline's commitment to fly you from one place to another; you can print it out, but the printout is not the ticket.
- **Values**. A value, in contrast, has no persistent identity that is distinct from its representation. Examples of values include numbers, strings and boolean flags. A value may carry a unit that determines how it is interpreted: a temperature in Celsius, a distance in miles. Values often have some structure: a string is a sequence of characters, for example, and a mailing address has a building number, street, city and zip code. Values, unlike individuals, are *interpreted*, which means that operations can be performed on them to compare them and create new values from old ones: for example, you can add numbers together, decide which is larger.

**Individuals aren't structured**. Note that an individual is represented *only* by its identity. If something is defined by its structure, then it must be a value and not an individual. So a pixel comprising three color values (for red, green and blue channels) must be a value and not an individual. Individuals have no inherent structure but they have properties that change over their lifetimes, and these properties do not define the individual. A company, for example, has divisions, employees, and products, but these don't define it; the company exists as an identifiable entity, and if two companies happens at some point to both have no divisions, employees or products, that does not make them the same company! But two pixels with the same color values are the same; they are one pixel, not two.

**A common misunderstanding**. This is extremely important because when an individual is an argument to an action, it does not bring with it any "attributes" or "properties". To the extent that a concept knows that an individual has some properties, those properties must have been associated with the individual by *this concept*. This is what ensures that concepts are truly independent of one another.

**Example: why individuals don't come with properties**. This is a simple criterion, but it can be confusing to novices. If a concept has an action that takes a person as an argument, for example, you might imagine that the concept should have "access" to the person's name, since every person presumably has one, and that the name is somehow part of the person. But this is a mistake, and a moment's thought will reveal why. How a person is named is the result of a non-trivial course of action that might include a name assigned shortly after birth (prior to which the person has no name!), taking a new name on marriage, changing a name for various reasons, using a social name that differs from a legal name, and so on. All this rich behavior points to a Naming concept that exists in its own right, and that can supply a name under some circumstances in coordination with other concepts.

**Object orientation: the source of confusion**. This confusion is a result of object-oriented thinking in which individuals are "objects" that carry around their properties with them. Such a notion of object makes sense for values, but it doesn't make sense for individuals. Returning to the example of a person and their name, consider how you would figure out the legal name of a person standing in front of you. There is no physical examination you could conduct. What makes a name their legal name is that it's registered with some government office. The name is no more "part" of the government office where it resides than "part" of the person. It's a property of the person, maintained by a Naming activity orchestrated by the government, in which both the person and government office participate.

### Example: HoldingBooking concept

> **concept** HoldingBooking
> **purpose** let you book something while available and buy later; prevents losing the booking or being forced to buy immediately
> **principle** when booking an item, you can hold it without buying; if you buy before the hold expires, the booking will still be available; if it expires before you buy, you lose the booking but no payment or cancellation is needed.

**Delineating this concept's actions**. There are three steps that are implied by the principle: holding the booking, hold expiring, and buying the booking. Losing the booking doesn't need to be an action in its own right because it's implied by the hold expiring. The payment and cancellation that aren't needed are by way of explaining what the concept does not do, so they don't correspond to actions. To clarify this delineation, we can mark the actions of the concept by italics or underlining:

> **concept** HoldingBooking
> **purpose** let you book something while available and buy later; prevents losing the booking or being forced to buy immediately
> **principle** when considering purchasing an item, you can *hold* it without buying, obtaining a booking with a limited lifetime; if you *buy* before the booking *expires*, the item will still be available; if it *expires* before you *buy*, you lose the booking but no payment or cancellation is needed.

**Additional actions**. Now we consider additional actions. Let's consider compensating actions:

- A user might want to remove a hold because there will be a limit on how many holds one user can have at once (typically just one). So we could add a *cancel* action. Alternatively, we could just have the hold action replace an old booking with a new one, and then no additional action is needed.
- The buying action may be undone by the user cancelling the purchase of the booking. But this cancelling is part of a different course of action and thus belongs to a different concept which might be called Buying. If this isn't clear, consider that holding and buying have different rules associated with them that are usually presented separately to customers; that including cancelling of the purchase would bring in scenarios completely unrelated to holding, such as when an airline cancels a flight due to low demand and refunds payments.

**Defining actions**. Now we define the arguments for each action.

Take the *hold* action first:

- **The booking**. The action results in a temporary booking being created. This reservation is given to the person performing the hold to represent the commitment that is being made to them. Since the booking does not exist prior to the hold action, but is instead created by it, it will be included as an output of the action.
- **The person holding it**. The booking should be associated with the person holding it, because otherwise there will be no way to control the number of bookings one person holds.
- **The item being held**. When the person fulfills the hold by buying the item, the item must be the same item that was held. So this item will need to be an argument too.

So we have defined this action:

> hold (holder, item): (booking)

in which

- *holder* is the person who makes the booking
- *item* is an airline seat or some purchasable item being held
- *booking* is the temporary booking giving the holder the right to buy it

All of these are individuals.

The remaining actions are easier to find arguments for, because they all involve a booking that is already in hand. So they will both take that booking as an input. In addition, the buy action will take the holder as an input, to ensure that the person buying the item is the same person who booked it:

> buy (holder, booking)
> expire (booking)

**Providing an individual just means providing an identity**. Having a booking as an argument does not mean that when the holder invokes the buy action they need to provide something like the contents of the booking. The booking is just an individual, so the argument is just the identity of that individual. In practice, the identity will be represented by some identifier (like a booking number) and it will be provided by the user typing it in or clicking on a link that contains it, or by continuing in a browser session that holds it.

**Who performs the expire action**? The expire action is performed by the system and not by the holder, at the time at which the booking expires (or shortly after). The mechanism by which the system calls the concept action is not part of the concept itself.

### Example: Reserving concept

The Reserving concept is a more challenging example. It follows a similar pattern to the HoldingBooking example, with a reservation in place of a booking. Here is the concept outline:

> **concept** Reserving
> **purpose** let you reserve a resource in advance so it will be available; prevents wanting to use a resource and finding it unavailable
> **principle** you reserve a resource for a particular date and time in the future, and can redeem it at that date and time and then make use of it.

**Delineating this concept's actions**. There are three steps that are implied by the principle: reserving the resource, redeeming it and using it. Delineating responsibility, we might identify only the first two as actions of the Reserving concept. The use of the resource is resource dependent; in a restaurant, it involves being seated and served a meal, whereas at a barber, it involves having a haircut. We'd expect a different lifecycle for these uses also: seating a diner involves selecting a table, which would likely be managed by a different concept.

To clarify this delineation, we mark the actions of the concept by italics or underlining:

> **concept** Reserving
> **purpose** let you reserve a resource in advance so it will be available; prevents wanting to use a resource and finding it unavailable
> **principle** you *reserve* a resource for a particular date and time in the future, and can *redeem* it at that date and time and then make use of it.

**Additional actions**. Now we consider additional actions. Let's consider compensating actions:

- A compensating action for reserving would be cancelling a reservation, so we add a *cancel* action to our list.
- We don't expect the redeeming to be undone: diners who turn up at a restaurant, for example, are not expected to say "I've changed my mind and I don't want a table after all". If such a situation arose, the maitre d' would just not assign a table, and nobody would be too bothered the reservation system had recorded a redemption even though it was not in fact used.

What other unhappy paths are possible?

- A customer might fail to show up to redeem the reservation. This can be represented by a *noshow* action that is deemed to have happened some time after the reservation was due.

It might seem odd to have an action that represents a non-happening, but in real life and in software systems such actions are often significant and need to be tracked. Just think of the number of movies in which the bride *not* turning up at her wedding is the most significant step in the plot! In restaurant reservations, the *noshow* action is typically used to ensure that people don't abuse the system by repeatedly reserving and not turning up. After some number of *noshows*, a user will not be allowed to make further reservations.

**Defining actions**. Now we define the arguments for each action.

Take the *reserve* action first:

- **The reservation**. The reserve action results in a reservation individual being created. This reservation is given to the person making the reservation to represent the commitment that is being made to them. Since the reservation does not exist prior to the reserve action, but is instead created by it, it will be included as an output of the action.
- **The person reserving**. The reservation should obviously be associated with a person, so we expect an input of a person individual. Who exactly this person should be is not so clear. Usually it's the person making the reservation, but in an alternative design it might be the person who is expected to redeem the reservation. This would become significant if a single person was not allowed to hold multiple reservations for the same time at once, because the former interpretation would prevent an administrative assistant from making reservations for different people! For now, we'll punt on this subtlety and assume that the two persons are one and the same.
- **The thing reserved**. Another argument should indicate what is being reserved. You might initially think that this could be a combination of multiple arguments, such as a restaurant, a date and a time. This might be a plausible design, but it would ignore the fact that the restaurant might not have availability at that time. This could be handled by extending the Reserving concept with actions that record the availability at given dates and times. But that brings in another whole course of action, and it's better to separate that out. To do that, we can assume that there will be some concept that tracks the allocation of resources (such as dining slots); the Reserving concept itself need only record that a particular resource (which exists out in the world and was previously allocated) has been reserved. So our decision is that we'll have an input that is a resource being reserved.
- **Considering other actions**. One way to identify input arguments for an action is to think about what information another action might need to know in order to happen. In this case, we might wonder how we'll know when a *redeem* or *noshow* action is allowable. Presumably the reservation can be redeemed before some time point and a no show recorded after some time. So we'll need to associate a *time* of usage with the resource.
- **Looking to domain knowledge**. Finally we might ask ourselves what we know about the domain of application that might suggest additional arguments. Thinking about restaurant reservations, we realize that we need to record the *party size*.

Summarizing, we have defined this action:

> reserve (reserver, resource, time, partySize): (reservation)

in which

- *reserver* is the person who makes the reservation
- *resource* is a dining slot or some other kind of resource
- *time* is the date/time that the redemption is expected
- *party size* is the number of people who will use the resource
- *reservation* is the agreement that was created by the action
  All of these are individuals, except for time and partySize which are values.

The remaining actions are much easier to find arguments for, because they all involve a reservation that is already in hand. So they will simply take that reservation as an input:

> cancel (reservation)
> redeem (reservation)
> noshow (reservation)

**Providing an individual just means providing an identity**. Remember that having a reservation as an argument does not mean that whoever invokes the action needs to provide some structured object that represents the reservation. The reservation is an individual, so the argument is just the identity of that individual. In practice, the identity will be represented by some identifier (like a reservation number) and it will be provided by the user typing it in or clicking on a link that contains it.

**Subtleties to understand**. This example illustrates some subtleties that often arise.

- **An action's inputs aren't always just what a user would provide**. You might expect the arguments of an action to be the inputs that a user would enter into a system. Thinking about what a user would enter is good for thinking about what might be candidate arguments, but it's not the end of the story. In this case, the user probably enters the restaurant name, requested date and time, and so on, but the action doesn't include the restaurant name. The reason is that we separated out the allocating of resources from their reserving. In the actual system, when the user enters all these details, another concept will be used to find an appropriate resource (or say that one is not available), and then that resource is the one that will be reserved. In short, by not requiring a literal match between what the user enters and what goes in the action inputs we are able to create actions that are independent of how the user interface is designed.
- **The performer of the action is not always an argument**. We chose to include the reserver as an argument of the reserve action. But had we decided to record instead the person who the reservation was being made *for*, we might not have recorded who made it. In general the identity of the person executing an action will be relevant for controlling access and for logging and other purposes. But there will be actions of other concepts that will handle that identity (such as an Authenticating concept), and there is no general requirement that an action should include the individual performing it. Instead, the criterion is simply whether or not the identity of that person is essential to the concept behavior. For Reserving, the answer may be no; for Authenticating, it will be yes.

## Defining State

The state of a concept is what it remembers of the actions that have occurred. The point is that a concept doesn't need to remember everything -- exactly which actions occurred and in which order -- but only enough to be able to determine which actions can happen next.

When a concept is realized in software, the state will be stored in hardware, for example in a database. When a concept is realized as a manual process in an organization, the state might be stored in paper records or in people's heads. As the processes embodied by concepts become more automated, their state is increasingly stored by a single computer system, and leaving any state to be recorded outside the system is usually a recipe for trouble.

For example, the Reserving concept needs to remember which reservations happened (that is, which reserve actions) so that it can determine which reservations can be redeemed. But it doesn't need to remember what order they came in, or to remember reservations that were subsequently cancelled.

When you define the state of a concept, it's never ok to define too little state -- state that is insufficient to support the actions. For example, if you don't store enough state to know that a reservation was made for a particular user, you won't be able to check when someone tries to redeem the reservation that they are the right user. But it is ok to store too much state -- more state than you strictly need. The reason to do that is that you might extend the concept with more actions later that might need that state, or you might want to allow more information to be available about which actions occurred. For example, when a reservation is cancelled, you could erase from the state all knowledge that the reservation was ever made; but you could also choose to remember the reservation and mark it as cancelled. That way, you'd be able to support functionality that reported on how often a user cancelled a reservation, for example. It's a tradeoff: the richer the state, the more useful, but also the more work to maintain it and the more storage required.

### Example of defining state: the Reserving concept

Often the inputs and outputs of actions point immediately to what should be in the state. Take the Reserving concept. The reserve action had the following inputs and outputs:

> reserve (reserver, resource, time, partySize): (reservation)

This suggests that the state should include:

> the reservations that have been made, and for each reservation its reserver, the resource reserved, the time for the reservation, and the party size.

To explore more fully what should be in the state, you need to consider all the actions and whether the state supports them. This is explained below.

## How to think about states with facts

Think of a state as some pools of individuals, and some collections of facts about them. Each fact relates some individuals to each other or to some values. This way of thinking is simple and powerful, and it aligns with various intuitive ways of depicting state, in particular showing state with tables or graphs.

### Example of states as facts: the Reserving concept

For example, a state of the Reserving concept might hold two reservations that have been made, call them Reservation 1 and Reservation 2, some reservers, call them Alice and Bob, and some resources, say Resource 3 and Resource 4. It might relate these individuals to each other and to some values like this:

| reservation | reserver | resource | time | party size |
| --- | --- | --- | --- | --- |
| Reservation 1 | Alice | Resource 3 | May 10, 2027 at 7:30pm | 4 |
| Reservation 2 | Bob | Resource 4 | May 12, 2027 at 7:00pm | 2 |
| There are 8 facts here, corresponding to each cell in the table. There are four facts for each row. For the first row they are: (1) that Reservation 1 has Alice as its reserver, (2) that Reservation 1 has Resource 3 as its resource, (3) that Reservation 1 has May 10, 2027 at 7:30pm as its time, and (4) that Reservation 1 has 4 as its party size. |  |  |  |  |

Note that Alice and Bob are being used here as identities of reservers. This was to make it a bit easier to grasp, but it would have been more consistent to have used identities similar to the other individuals. For example, they might have been Reserver 23 and Reserver 12. Just remember that the reserver of a reservation is the identity of the individual who reserved (and not their first name!).

## Connecting states with actions

The final task is to connect the states with the actions, by saying, for each action, how to use the state to decide *when* it can occur, and *then* how the state is updated. When an action has outputs, you say how the outputs come from the inputs and the state.

### Example of connecting states with the Reserving concept

Taking each action in turn, starting with reserve:

> reserve (reserver, resource, time, partySize): (reservation)
> **when** there's no reservation already for this resource
> **then** create a new reservation for this reserver, resource, time and party size

> cancel (reservation)
> **when** this reservation exists
> **then** remove the reservation

> redeem (reservation)
> **when** this reservation exists and its time is now
> **then** remove the reservation

> noshow (reservation)
> **when** this reservation exists and its time has passed
> **then** remove the reservation

The reservation existing just means that it's in the pool of reservations stored in the state, and removing a reservation means that it's taken out of the pool along with all of its facts. The reference to "its time" for a reservation uses the fact that is stored that remembers a time for each reservation. Note that these definitions are a bit vague about what it means for a reservation's time to be now or to have passed; before the design is deployed, these details will need to be filled in (for example, by saying that "now" means within 15 minutes of the reservation time).

As an example of how the state impacts what actions can happen, consider changing the definition of *redeem* so that it no longer deletes the reservation. That would allow *redeem* to be performed twice in a row, which would be confusing at best.

## A common idiom

The behavior embodied in a concept usually involves collections of individuals. Some of these individuals start in the environment; they are passed from the environment to the concept as inputs of actions, stored in the state and then passed back as outputs of other actions. Other individuals start in the concept itself, and are passed to the environment as outputs and then passed back from the environment to the concept as inputs.

> Example. In the Reserving concept, the reservers are individuals that start in the environment; the reservations are individuals that start in the concept itself. The reserve action takes a reserver as an input creates a reservation for that reserver, and returns the reservation as an output.

These concept-created individuals often correspond to some kind of resource that a user can hold onto. Remember that individuals aren't "objects" in the object-oriented sense. They can't be "opened up" outside the concept, and they don't have any built-in properties or attributes. In the terminology of programming, the individuals of concept design are "handles" or "identifiers" whose meaning comes from how they mapped within the concept state.

> Example. The reservation individual is a handle that a reserver can use to cancel or change a reservation. It doesn't carry the time of the reservation or the name of the restaurant. Of course a reservation app will send a confirmation message that includes all these things, but these will be provided along with the reservation, not within it. The reservation may be represented as a number or an alphanumeric string. More commonly the message would include a URL which when accessed lets the reserver see and modify the reservation. In this case, a separate concept, ResourceLinking say, would manage the creation of links and their association with reservations.

## States or actions first?

As explained earlier, the design of a concept can begin with actions and then move to defining state. In this approach, the actions characterize the observable behavior, and the state is an answer to the question of what must be remembered to support the actions.

An alternative approach goes in the other direction. The state is regarded as the primary aspect of the concept that is observed, and the actions are an answer to the question of what must be done to establish the state.

Which approach to use depends on what seems most natural when thinking about the behavior. Sometimes the purpose of a concept is naturally expressed in terms of creating state; sometimes it is more naturally expressed in terms of supporting certain actions.

> Examples. The purpose of a Posting concept, as used in a social media app, is to allow authors to easily publish short pieces. The posts, and the facts associated with them (that they have authors, contents and creation times), come to mind immediately, and the actions (creating, deleting and editing posts) follow. In contrast, the purpose of the Moderating concept is to allow users to flag potentially unacceptable posts, which are then accepted or rejected by a moderator. The actions come to mind first, and the state (which posts have been flagged pending moderation, and how they have been classified) follows.

In more complex concepts, the design may require an interplay between actions and state.

> Example. In the Upvoting concept, whose purpose is to crowdsource quality ranking of some items, the basic actions (upvote and downvote) and the basic facts in the state (the number of votes each item has) are clear. But the need to include in the state *which* user has voted for each item only becomes clear when one considers the need to prevent double voting.

Some concepts embody clever protocols that require more ingenious design of the state and actions.

> Example. In the TimeBasedAuthenticating concept (implemented by authenticator apps, and often called "timed one-time passwords"), a user registers with a service, and then later authenticates by entering the latest value of a secret number updated by a periodic action. Devising the state of this concept calls for some basic cryptographic knowledge. In the initial register action, a *shared key* that is unique to the user must be generated and stored. If this were not done, and the numbers were generated based on the time alone, they would be the same for all users, defeating the whole point of the design.

## Completed concept definition

The completed concept definition includes:

- the name
- the purpose
- the principle, with actions italicized or underlined
- the state
- a list of actions, each with its arguments and effect on the state

Sometimes it will be fairly obvious how the actions are connected to the state, and a designer may choose to omit those details, and just list the actions with their arguments alone. But they need to be included eventually, and if they are inserted by an agent, a designer should check them before deployment.

### Example of a completed concept definition: the Reserving concept

> **concept** Reserving

> **purpose** let you reserve a resource in advance so it will be available; prevents wanting to use a resource and finding it unavailable

> **principle** you *reserve* a resource for a particular date and time in the future, and can *redeem* it at that date and time and then make use of it.
>
> **state**
> the reservations that have been made, and for each reservation its reserver, the resource reserved, the time for the reservation, and the party size.
>
> **actions**
>
> reserve (reserver, resource, time, partySize): (reservation)
> **when** there's no reservation already for this resource
> **then** create a new reservation for this reserver, resource, time and party size
>
> cancel (reservation)
> **when** this reservation exists
> **then** remove the reservation

> redeem (reservation)
> **when** this reservation exists and its time is now
> **then** remove the reservation

> noshow (reservation)
> **when** this reservation exists and its time has passed
> **then** remove the reservation
