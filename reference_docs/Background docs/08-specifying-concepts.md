# How to write concept specifications

Source: [How to write concept specifications](https://61040.github.io/fa26/background/specifying-concepts/)  
Downloaded: October 5, 2026

Writing concepts down is useful. Most straightforwardly, you want to define what a concept *is*, namely the behaviors that it offers. By focusing on behavior rather than appearance (in a user interface) or implementation (in the code), you can ensure that the same definition can serve different people coming from different perspectives, whether concerned with user experience, software architecture, engineering, marketing, sales, and so on. The concept becomes a bridge between roles. And because a concept can capture common functionality between apps and services, it becomes a bridge also between teams.

In practice, being clear about what a concept *is* often means explaining what it *is not*, what it *was* previously, and what it *might be* in the future. The concept definition thus serves as the repository of accumulated knowledge and understanding, of plans for the future, and of ongoing design debates. Obviously defining all these counterfactuals in full detail would be impractical, so they are generally described in informal notes.

In addition to saying *what* a concept is, the concept definition should say *why*: why the concept was adopted or invented in the first place, and why particular decisions were made about its behavior. These 'why' questions often feel uncomfortable, but attempting to answer them can be extremely productive (especially when it turns out that different stakeholders have different, and even incompatible, motivations).

A concept definition has at least the following parts:

- The concept name
- The types section, introducing names of external types
- The concept's purpose
- The operational principle
- The state definition
- The action definitions

Designers tend to augment this minimal definition with additional elements, such as links to related concepts, typical reactions associated with the concept, a history of revisions, and (perhaps most importantly) informal notes that explain the definition and its alternatives.

The concept *name* should signal the essential functionality of the concept. The functionality will generally be an activity occurring over a prolonged period, so names that would be appropriate for actions that occur instantaneously will not be appropriate. And although the functionality may be primarily associated with one type of individual, it's preferable not to choose a name that could be confused with such a type.

**Example: Choosing a concept name for authenticating users**. The concept that handles the functionality of authenticating users might be called `UserAuthenticating` . The name `Authenticate` is not good because it is more appropriate to the action that authenticates a user after they have registered. The name `User` is not good because it could be confused with the type of users, and anyway does not convey the functionality.

In concept notation, the external types can be listed in square brackets after the concept name. They can also be listed in a *types* section (which can also introduce enumeration types).

**Example: Recording external types**. To say that the external types of the `Reserving` concept are `User` and `Resource`, write the following in its `types` section:

```
types
  external User
  external Resource
```

In an abbreviated definition, the external types can instead be listed in square brackets after the concept name:

```
concept Reserving [User, Resource]
```

The concept *purpose* explains the motivation for the concept: the value that its functionality brings. The purpose should meet three criteria:

- **Need-focused**. The purpose should be stated in terms of needs, and should not just recapitulate or summarize the functionality.
- **Specific**. The purpose should be specific to the design of the concept at hand, and not just express some generally desirable quality of the system as a whole, or a need that is universal.
- **Evaluable**. A purpose should be a yardstick against which to measure a concept design. It should support an objective evaluation of whether the functionality meets the needs.

**Examples: Purpose criteria for Upvoting**. Here are examples of applying these criteria to the purpose of an `Upvoting` concept. An appropriate purpose might be 'to use crowd-sourced approval to rank items.' The criteria would rule out some other purposes as follows:

- **Need-focused**. The purpose should not be 'to let users express approval of items' since this just describes what a user does when upvoting an item, and doesn't explain why this has any value.
- **Specific**. The purpose should not be 'to increase user engagement.' Even though user engagement is an important driver for many companies designing social media apps, this is a (partial) goal of almost every concept.
- **Evaluable**. The purpose should not be 'to improve the quality of user-authored items', since this purpose is too distant from the actual functionality of the concept for it to be a reasonable yardstick for evaluation.

**Examples: Purposes for other concepts**. Here are some examples of purposes for various concepts. For simplicity, the external types are omitted.

For the `Trashing` concept, as invented by Apple in the 1980s, in which deletion places items in a special area from which they can be restored:

```
concept Trashing
purpose to mitigate accidental deletions by allowing deletions to be undone
```

For the `Styling` concept, as invented for the Alto at Xerox PARC, and popularized in Microsoft Word, in which paragraphs (for example) can be assigned formatting styles that can be updated:

```
concept Styling
purpose to enable consistent formatting of documents
```

For the `Notifying` concept, as used in almost all apps, in which users receive notifications when events of interest or relevance happen:

```
concept Notifying
purpose provide users with timely notifications of events of interest
```

For the `RoleBasedAccessing` concept, as used in role-based access control, in which users are assigned roles that have predefined permissions:

```
concept RoleBasedAccessing
purpose simplify assignment of user permissions
```

A concept should have *exactly one purpose*. Obviously, a concept should have at least one purpose. If it has no purpose, there’s no reason for it to exist. More controversially, a concept should have *at most* one purpose. This might seem strange, especially since some people think that a good design decision solves multiple problems at once (or feeds many birds with one scone, as the politically correct version of the old adage goes). In fact, this is a misconception, and rigorously separating purposes so that each concept has only one purpose is the path to more flexible software, and to avoiding conflating different aspects of behavior in a single concept. A concept with more than one purpose is said to be *overloaded*.

**Examples: Overloaded purposes**.

- Facebook's `Friending` concept serves two purposes. One is to provide access control so you can limit who sees your posts. The other is to filter your own incoming content, so you can choose whose posts you want to see. These two purposes are not always in alignment; you might want to see someone’s posts but not share yours with them, or vice versa. A better design is to separate these purposes out, with `Friending` determining who can see your posts, and `Following` determining which posts you see.
- Many apps have a concept for managing personal user information, such as your username, password, display name and so on. Such a concept conflates authentication functionality and profile display functionality. Splitting into two separate concepts, say `UserAuthenticating` and `UserDisplaying`, allows these to be separated and makes it clearer to the user how different data is used (for example, whether the username is displayed publicly).

Sometimes a concept brings value to different stakeholders, but there is actually no overloading because you can identify an overarching purpose that both stakeholders are benefiting from.

**Example: Overarching purpose**. In a restaurant reservation system, the `Reserving` concept helps diners by giving them confidence that there will be a table for them when they turn up, and it helps restaurant owners know which tables will be available for walk-ins. Both of these benefits can be seen to be aspects of a single purpose:

```
concept Reserving
purpose making utilization of resources more predictable
```

A concept's purpose should be only as specific as the concept itself, and it should not refer to the context of use of the concept in the larger application or system. Doing so only makes the concept less reusable.

**Example: Concept purpose tied to system context**. If the `Reserving` concept of a restaurant reservation system is designed to allow reserving any kind of resource, it would be inappropriate to write

```
concept Reserving [User, Resource]
purpose making utilization of dining slots more predictable
```

since the concept is about generic resources, not dining slots --- even though it will be the case that at runtime each resource within `Reserving` will be a dining slot.

The *operational principle* (or *principle*) is an archetypal scenario that demonstrates how the concept fulfills its purpose. A compelling way to explain how something works is to tell a story. Not any story, but a kind of defining story.

It is important to understand that although an operational principle, being a scenario, looks a bit like a use case or user story, it is actually quite different. Its role is to tell a story that explains the essential behavior of the concept and motivates its design. It is *not* intended as a specification of the behavior, which will be provided in full by the states and actions.

**Example: A defining story for a service**. The Minuteman Library Network, for example, offers a wonderful service. If I request a book, then when it becomes available at my local library, I get an email notifying me that it’s ready to be picked up.

Note the form this scenario takes: *if* you perform some actions, *then* some result occurs that fulfills a useful purpose. Many kinds of mechanism can be described in this way.

**Examples: More mechanisms defined as stories**.

- If you make social security payments every month while you work, then you will receive a basic income from the government after you retire.
- If you insert a slice of bread into the toaster and press down the lever, then a few minutes later the lever will pop up and your bread will be toast.
- If you become someone’s friend on social media and they then publish an item, you will be able to view it.

A concept's operational principle is a story that explains the functionality of the concept, showing how it fulfills the concept's purpose. The key elements of the story are the actions and states of the concept.

**Examples: A simple operational principle**. The principle for the `Reserving` concept is very simple and minimal, because the concept is very general so there are none of the details that you'd expect if the concept were specialized to, for example, restaurant reservations, airline seat assignments or conference room bookings.

- **Reserving**. If a user reserves a slot, they can then redeem it at a later point.

The operational principle is the scenario that motivates the existence of the concept. It does not have to include variant or failure cases. For some concepts though, an action that represents canceling or undoing is actually central to the concept's purpose, and then it must appear in the principle.

**Examples: Operational principles of two permissioning concepts**. Here are principles of two different concepts, that show a crucial difference between them. For standard user authentication, deleting or suspending the account is not fundamental. But for token based accessing, the revocation of tokens is central, since the very reason for issuing multiple tokens to different parties is to allow one to be revoked without affecting another.

- **UserAuthenticating**. If you register with a user name and password, and then you login with that same user name and password, you will be authenticated as the user who registered.
- **AccessTokenSharing**. A user can create access tokens for a resource and pass them to other parties, who may then provide their token and obtain access. If the user revokes a token, the party who received that token will no longer be able to use it to obtain access.
  These two concepts in fact have very different purposes: `UserAuthenticating` is (as its name suggests) for authenticating users, but `AccessTokenSharing` is to allow a user to grant access to other parties who are not authenticated as that user.

A principle should generally be as simple as possible, using as few individuals as possible. But sometimes multiple individuals and occurrences of the same action are needed to convey the essence of the concept.

**Example: Operational principle that requires multiple individuals**. The essence of upvoting is that an item (eg a social media post) is ranked according to the aggregate upvotes that it receives from multiple users. Here is an bad principle because it doesn't convey this idea:

- **Bad principle for Upvoting**. If a user upvotes an item, the number of votes on the item increases by one.
  and here is a better one:
- **Good principle for Upvoting**. If a multiple users upvote a collection of items, the items can be ranked according to the number of votes that each received.

**Example: Operational principle for Styling**. Here is another example of a principle that requires more than one occurrence of an action:

- **Principle for Styling concept**. After a style is defined and applied to multiple paragraphs, updating the style will cause the format of all those paragraphs to be updated in concert.

A good principle should satisfy three criteria:

- **Goal focused**. The principle should demonstrate how the purpose is fulfilled. Often the last action or state in the principle corresponds to some goal that has been achieved. This is a key respect in which principles often differ from user stories, which may describe a scenario that has an observable outcome but not the value that motivates the design.
- **Differentiating**. The principle should distinguish the functionality of the concept from other concepts, especially simpler ones, for example by including actions that are special to the concept and essential to its behavior.
- **Archetypal**. The principle should not include corner cases that are not essential to demonstrating how the concept fulfills its purpose.

**Examples: Applying the criteria**.

- **Goal focused**. The principle for `Reserving` should not just say that having executed a reserve action for a resource, that resource is now reserved for that user. The value comes when the user actually redeems the reservation (for example, by being seated at the restaurant), so redeeming must be included in the principle.
- **Differentiating**. The principle for `AccessTokenSharing` should include tokens being given to multiple parties and being revoked. Without these complications, the concept would not be needed. If there were just one user, for example, a simple password-based user authentication concept would suffice.
- **Archetypal**. The principle for `Reserving` should include reserving a resource and redeeming the reservation, but it does not need to include the possibility that the reservation is canceled, even though the concept will generally include an action to support this. The reason such cases are not needed is that the states and actions sections fully define the behavior of the concept and thus define all possible scenarios implicitly; the role of the principle is to identify the essential scenario that motivates the design and shows how the purpose is fulfilled.

The operational principle can be written formally and precisely, but because it plays a crucial role in telling the story of the concept it can be preferable to write it in a way that makes it as accessible as possible.

**Example: formal and informal principles**. As an example, consider the `UserAuthenticating` concept, whose principle might be expressed formally or informally. The formal version is more succinct but a bit cryptic, since it relies on understanding how the variables are bound.

- **Formally**. After register(username, password):(user), login(username, password):(user).
- **Informally**. If you register with a user name and password, and then you login with that same user name and password, you will be authenticated as the user who registered.

A concept definition should *not* make reference to the actions or states of other concepts within the sections describing its own states and actions. But in the operational principle (and to a degree within the purpose), it can make sense to imply the existence of actions and states belonging to other concepts.

**Example: Operational principle that suggests actions from other concepts**. For example, the operational principle of the `Notifying` concept might be: 'If a user registers for a particular event type, then when an event of that type occurs, the user will be notified.' This `Notifying` concept might have an action called `notify` that is executed in response to an event, but that action is unlikely to actually notify a user. Instead, it would typically be synchronized (with a reaction) with an action from another concept that causes some communication to occur (for example, an email or text or in-app announcement). So strictly speaking, the operational principle of the `Notifying` concept assumes this reaction. Likewise, when we specified the purpose of `Notifying` above as 'provide users with timely notifications of events of interest', it should be recognized that this purpose is contingent on the presence of other actions that will actually convey the information to the user.

The *state* section of the concept defines the state that the concept stores in order to perform the actions. In behavioral terms, the state of a concept is a collection of relations, each holding some particular relationships.

The state may be used to determine whether an action is permitted to happen, and to determine which outputs the action produces. When an action is executed, the state is updated. In this sense, the state represents what the concept remembers about the sequence (or trace) of action occurrences.

**Example: State of Upvoting concept**. The state of an upvoting concept will obviously need to track how many times each item has been upvoted, and each occurrence of the `upvote` action will increment the count for the item given. But if double voting is to be prevented, the `upvote` action will have to be permitted only when that user has not already upvoted that item. And this implies that the state will have to hold not only how many votes an item has, but also which users those votes came from.

**Example: State of Reserving concept**. A `Reserving` concept used in a restaurant reservation system may have a `cancel` action that allows a reservation to be cancelled. In one possible design, cancellation causes the reservation to be deleted and forgotten about. In that case, the action would not need any particular support in the state. But in another design, no reservations are ever forgotten about; this would allow the user to see, for example, a list of active reservations along with those that have been cancelled. To support this, the state would need to record additional information about which reservations are active and which have been cancelled.

The state section of a concept is a data model. Unlike a conventional data model which represents the full state of an entire system, a concept data model represents only the part of the state that is relevant to the concept's behavior.

**Example: Partial data models for user-related concepts**. In a conventional data model, a user might have attributes such as username, password, display name, and so on. In a concept state, only those attributes that are relevant to the concept would be included. In a `UserAuthenticating` concept, for example, the mapping from user to password would be included (and perhaps also the username, although even that might be separated into a naming concept). The display name is not relevant to authentication, so would not be included, but would appear in a concept such as `UserDisplaying` that manages how user information is displayed for other users.

A note about the word *state*. There is a potential ambiguity, because the word is used with two subtly different meanings. One meaning is a particular state out of all possible states. The other meaning is the definition of the set of all possible states. It is in this second sense that the word is used as the title for the state section in a concept definition.

The state of a concept can be written in different ways. Simple State Form (SSF) was developed as a notation for states that is intended to be rich enough to describe complex data models, natural-sounding enough to be comprehensible to non-experts, and easy to translate into code. A separate document describes SSF, so here we will focus on explaining some of the key features.

A declaration introduces a set of individuals and then any number of relations involving that individual.

**Example: State declaration**. The following declaration introduces a set of reservation individuals, along with two relations, one associating reservations with users, and one associating reservations with slots:

```
a set of Reservations with
  a User
  a Slot
```

Note that there are actually three components of the state being declared here: the set and the two relations. The set defines the reservations that exist in the scope of the concept, so the assertion that some reservation exists is tantamount to saying that it's a member of this set.

Note that declaring a set of individuals does *not* mean that the concept 'owns' those individuals. The individuals that are owned by a concept are those that it creates, which are those that have an internal type. Individuals of an external type can still be stored within the concept. In this case, the concept stores external individuals with whatever relations it attaches to them.

**Example: Storing external individuals**. A concept for upvoting which declares the type User to be external may include a state component that is a set of users, as follows:

```
concept Upvoting [User, Item]
...
state
  a set of Users with
    a set of Votes
  a set of Votes with
    an Item
```

This means that the concept stores a set of users who have voted, and for each user stores the set of votes they issued. All votes are stored as a separate set and each vote is associated with an item. Both users and items are external; only the votes are internal and are created by the concept. But note importantly that the concept can still store a set of users with their votes. Do not be mislead by object-oriented thinking which might suggest that there can only be one declaration of `a set of Users` amongst multiple concepts. On the contrary, this is the primary means by which concepts attach their own properties to individuals.

Each relation has a name that can be specified explicitly, or if not specified, is given implicitly by the name of the type that follows.

**Example: Implicit relation names**. In this declaration

```
a set of Reservations with
  a User
  a Slot
```

the two relations have the implicit names user and slot, so the declaration is equivalent to this one in which the relations are explicitly named:

```
a set of Reservations with
  a user User
  a slot Slot
```

A declaration constrain the multiplicity of each relation, according to whether one of the keywords `unique`, `optional` or `set` is used.

**Example: Multiplicities of relations**. This declaration introduces a relation called `friends` that associates each user with a set of zero or more users that are their friends:

```
a set of Users with
  a friends set of Users
```

This declaration introduces a relation called `displayName` that associates each user with one string or no string:

```
a set of Users with
  an optional displayName String
```

This declaration introduces a relation called `userName` that associates each user with a string that is unique -- that is, no two users share the same string:

```
a set of Users with
  a unique userName String
```

This declaration says that each reservation has a user and slot associated with it, and the slot is unique -- that is, no two reservations share the same slot:

```
a set of Reservations with
  a User
  a unique Slot
```

A note about naming relations. The name of a relation should generally convey its meaning. Often however there is only one plausible meaning given the type, and in that case it's common to use the type itself as the name. This aligns with a view of the relation as a function that maps one individual to another.

**Example: Names for relations**. The declaration

```
a set of Reservations with
  a user User
  a slot Slot
```

introduces two relations, `user` and `slot`, that viewed as functions map a reservation to the user and slot associated with it. These names only convey the meaning partially though. What exactly does the relationship between the reservation and the user mean? The assumption here is that there is a single user associated with a reservation who both made the reservation (who the reservation is *by*) and who plans to turn up to redeem it (who the reservation is *for*). If this mattered, especially if we wanted to store both relations, we would use more meaningful names:

```
a set of Reservations with
  a by User
  a for User
  ...
```

The actions section of the concept definition lists each type of action with the types of the individuals that participate in it, and then describes the relationships that must hold for the action to occur, and how the action adds and removes relationships.

The arguments of an action can be divided into the *inputs*, which are selected by the instigator of the action, and the *outputs* that are results of the action. An action can have any number of inputs or outputs. In particular, it may have no output or more than one. It's common in programming languages to name inputs but not outputs since there can generally only be at most one output. But since concept actions allow more than one output, for uniformity all outputs are generally named.

Each input or output is given a name, which is a variable or placeholder for the actual input or output in an occurrence of the action, and a type. Arguments are usually individuals but may also be *values* (such as primitive types or composites of primitive types). There is nothing in concept design corresponding to passing a mutable object.

The part of the action definition that declares the action name and the names of the inputs and outputs with their types is called the *signature* of the action.

**Examples: Action signatures**. Here are some examples of action signatures. The `reserve` and `create` actions each have a single output. The `cancel` and `setUnavailable` actions have no output.

```
reserve (user: User, resource: Resource) : returns (reservation: Reservation)
cancel (reservation: Reservation)
create (restaurant: Restaurant, time: Time, date: Date): returns (slot: Slot)
setUnavailable (slot: Slot)
```

**Example: Reaction for notification**. A reaction for notification might specify that when the `notify` action happens, a `send` action of a Messaging concept follows, with the same arguments (and the event type and link concatenated into a single string):

```
when Notifying.notify (user, type, link)
then Messaging.send (user, type ^ link)
```

An action may accept an optional input. Mark an optional input with `?` after its name, and make sure to include in the specification what happens when it is omitted.

**Example: An optional input**. A `Messaging` concept might have a `send` action that sends a message to a user, that takes the user and the message as inputs, and optionally also takes a communication channel (such as text or email), using a preferred default when the channel is missing.

```
send (user: User, message: String, channel?: Channel) : return ()
```

At the design level, a precondition can be enough to say that an action cannot occur with inappropriate arguments. When it matters how an attempted action is refused, describe that case explicitly. Write a refusal as `refuse`, followed by a code and a quoted explanation. The normal concept return signature specifies the successful outputs, which are not returned when the action refuses.

**Example: Distinguishing refusal cases**. The `register` action of a `UserAuthenticating` concept creates a user when the username and password are well formed and the username is not already associated with an existing user. To also specify what happens when these conditions are not met, write separate cases within the same action. Each case begins with `where`, followed by `then` and its effects, ending in either a return or a refusal:

```
register (username: String, password: String) : return (user: User)
  where username and password are well formed and username is not already in use
  then
    create a new user with the given username and password
    return user
  where username or password is not well formed
  then
    refuse INVALID_CREDENTIALS "The username or password is not well formed."
  where username and password are well formed and username is already in use
  then
    refuse USERNAME_TAKEN "The username is already in use."
```

The refusal code identifies the reason for refusal, and the quoted sentence explains it to the caller. The conditions distinguish the cases: here, ill-formed credentials are refused even if the username is also already in use.

As mentioned earlier, an action's occurrence is generally contingent on certain relationships holding prior, and it causes relationships to be added and taken away. In state terminology, there is a *precondition* that holds in the state before execution of the action, and a *postcondition* that holds after. The precondition can involve the inputs too, so it's a constraint on the combination of inputs and the state before. If there are outputs, the postcondition will involve them too, so it's a constraint on the combination of the state before, the inputs, the outputs and the state after.

The precondition is labeled with the keyword `where` and the postcondition is labeled with the keyword `then` .

**Examples: Preconditions and postconditions for actions**. A `Reserving` concept with this state

```
a set of Reservations with
  a user User
  a unique slot Slot
```

may have a `reserve` action defined as follows:

```
reserve (user: User, slot: Slot): returns (reservation: Reservation)
  where no reservation already exists for slot
  then creates a new reservation with given user and slot and returns it
```

and a `cancel` action defined as follows:

```
cancel (reservation: Reservation)
  where reservation exists
  then removes reservation
```

Note that the existence of reservations is with respect to the set defined by the state declaration (`a set of Reservations`). Creating a new reservation means adding a new individual to this set, and removing a reservation means removing a reservation individual from this set.

Conceptually, an action adds and removes relationships (that is, adds and removes tuples of relations), but it's common to write the postcondition more informally as if the relations were fields of objects being updated. It's important to remember, however, that this is just a convenient way to describe how the relations change, and there aren't any composite objects being stored. This is important because when individuals are passed between concepts (in reactions), it's only the individuals that are being passed (that is, their identities), and none of their properties are passed with them.

**Example: Changes to a relation expressed as field updates**. A `UserAuthenticating` concept with this state

```
a set of Users with
  a unique username String
  a password String
```

may have a `changePassword` action defined as follows:

```
changePassword (user: User, newPassword: String)
  where user exists
  then sets password of user to newPassword
```

Strictly speaking, the effect of the action is to remove any relationship `(user, oldPassword)` that previously existed and to add a new relationship `(user, newPassword)` . It's intuitive to talk about 'setting the password of user' but remember that `user` is just an individual, associated by relations in the state to a username and a password. There is no 'user object' that *contains* a username and password.

When a postcondition does not mention a state component, that state component is assumed to be unchanged. That is, there is an implicit *frame condition*.

**Example: Implicit frame condition**. In the `changePassword` action

```
changePassword (user: User, password: String)
  where user exists
  then sets password of user to be the given password
```

the postcondition only mentions changing the password of the user, so the username is unaffected.

Remember that a declaration of the form

```
a set of As with
  a B
  a C
```

introduces a set of individuals of type `A`, and two relations (one from individuals of type `A` to individuals of type `B`, and one from individuals of type `A` to individuals of type `C`). This declaration does *not* introduce a set of objects each of which *contains* a `B` field and a `C` field inside it. This when an individual of type `A` is presented as an input to an action, the input is just the identity of the individual. The reason the action can refer to the `B` individual associated with it is that the relation from `A` to `B` is in the state of the action's concept.

A different concept might have a relation that maps each `A` to a different type of individual (`D`, say). Thus the individual can have different associations or properties in different concepts. This is key to the separation of concerns that concept design encourages. In specification circles, this strategy is called *view separation* because there are two views of the same individual.

**Example: Separation of concerns by view separation**. A `UserAuthenticating` concept and a `UserDisplaying` concept may have different views of a user. In `UserAuthentication`, a user may be associated with a username and password:

```
concept UserAuthenticating
state
  a set of Users with
    a unique username String
    a password String
```

and in `UserDisplaying` a user may be associated with a displayname and bio:

```
concept UserDisplaying [User]
state
  a set of Users with
    a displayName String
    a bio String
```

Note that a single type of individual can only be allocated in one concept. In this case, users are allocated in `UserAuthenticating`. The `UserDisplaying` concept is generic over a User type; its state associates a `displayName` and `bio` with whatever individuals that type instantiates. When composed together, the external `User` type of `UserDisplaying` will be instantiated with the users of the `User` set from `UserAuthenticating`, and this is how a single user individual will come to have `username` and `password` properties in one concept and `displayName` and `bio` properties in another.

How the state of concept changes (with relationships coming and going) as actions happen is part of its observable behavior. In contrasting to many programming language notions of module state, there is no sense in which the state is 'private' to the concept and not visible from the outside. At a design level, there is therefore no need to define 'observer' functions to read the state.

At the code level however, state is accessed through predefined *queries*. Unlike an action, a query can always be executed (has no precondition), never updates the state, and its occurrence is not generally a significant event. Query names begin with an underscore to distinguish them from actions. The signature gives the inputs and named outputs, and the specification says which results are returned, including what happens when an input refers to an unknown individual.

A query's signature also specifies how many results it can return:

- `one` means exactly one result.
- `optional` means zero or one result.
- `many` means zero or more results.

Each result is a structured object containing the named outputs. For example, a query that counts reservations can return `one (count: Number)`, even when the count is zero. A query that looks up a reservation can return `optional (user: User, slot: Slot)`, with no object when the reservation does not exist. For a query that returns `many` rows, the specification should say whether their order matters and, if it does, how they are ordered.

**Example: Query**. The `Reserving` concept may have a query that takes a user and returns the slots that that user has reserved:

```
_getReservedSlots (user: User) : many (slot: Slot)
  Returns a slot for each reservation of the given user, or no rows if the
  user has no reservations. The order of the rows is unspecified.
```

Order has no particular meaning in this example, but a query for upcoming reservations might order its results by reservation time.
