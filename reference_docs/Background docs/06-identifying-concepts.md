# How to identify concepts

Source: [How to identify concepts](https://61040.github.io/fa26/background/identifying-concepts/)  
Downloaded: October 5, 2026

## Concepts as granular design elements

Concept design proceeds, unsurprisingly, by the design of *concepts*. Each concept is an independent subject of design in its own right. A concept can be motivated, designed, analyzed and implemented by itself, providing all the benefits of incremental development and division of labor. Most system designs call for more than one concept, requiring that the concepts be *composed* so that they work together appropriately. This composition involves *coordinating* the behaviors of the concepts and does not compromise the independence of the concepts themselves. They remain independent and ignorant of the presence of the other concepts, even as the coordination ensures that they work together in concert.

## The lifetime of a single concept

Due to the independence of concepts, the concepts of a system can evolve independently of one another, on different time scales. Many factors will determine the order in which concepts are developed, including: which problems are most pressing; how much work is involved for a particular concept; what the risks are of getting a concept wrong; which subject-matter experts are available to influence the design of a concept; what combinations of concepts form coherent subsets; when testing is feasible; and so on.

But the order of steps *within* the development of a single concept does not tend to vary:

1. The concept is **identified**, and **defined** in outline with a name, purpose and principle.
2. The concept is **generalized** to make it more widely applicable, eliminating accidental details that came from the situation that motivated it.
3. The concept is **elaborated** to describe its mechanism, in terms of actions and states.
4. The concept is **implemented** and **deployed**.

This document describes the first two steps. The other steps are described in other documents.

## A concept describes an activity

People understand a system through what it lets them do: invite someone, share a file, leave a review, or borrow a book. A library can replace paper cards with barcodes without changing what it means to borrow a book. The machinery changes, but the activity remains.

A **concept** embodies a single **course of action** in a clear and independent form. We will often use the terms "activity" and "behavior" as synonyms for "course of action" because they are shorter, but "course of action" has the merit of making it clear that the behavior is a chosen design and not accidental.

Designers can use that form to ask what people gain from the activity, which bad situations the activity is intended to prevent, and what must stay recognizable when the activity is used elsewhere. The answers become design knowledge that others can build on.

**Concept design** builds a system by choosing which concepts it needs and deciding how they work together. By adopting a concept, the design makes a promise about what people will be able to do and what they can expect when they do it. Writing each promise in its concept shows which ideas the system inherits, which it invents, and where each commitment is defined.

## A concept's minimal form

The minimal form for a concept has three parts:

- The concept's **name**, which acts as a shorthand and pointer for design discussions, and helps established a shared language amongst stakeholders.
- The concept's **purpose**, which holds its motivation: **why** it was designed or selected.
- The concept's **principle**, which gives one or more archetypal scenarios that characterize the concept's behavior: **what** is does.

The elaborated form of a concept extends the description of **what** it does by providing a full mechanism that is sufficient to predict its behavior in all scenarios.

## Identifying concepts

The starting point of a concept design is a problem to address: a bad situation to mitigate. There are several ways to find a suitable concept to address the problem:

- **Adoption of an existing concept**. A designer adopts a concept by preserving a recognizable course of action (which may or may not have been identified explicitly as a named concept) in a new design. The new setting need not reproduce the machinery or every consequence of the earlier one.
- **Adaptation of an existing concept**. You might recognize an existing activity that provides the context in which you plan to devise a new one. Documenting the existing activity grounds your understanding of the current situation and is useful even if the concept you end up designing is new, and not an adaptation.
- **Innovating a new concept**. An innovation gives people a course of action they did not have before.

Even if a concept is not an innovation in the context of a particular design, iand existed already, tt must have been innovated at some earlier point. In that sense every concept is an invention.

> Example. Even the humble Reserving concept in which a reserver obtains a reservation promising future access to some resource must have been invented by someone at some time. Applied to restaurants, it seems that the concept was first used in the late 19th century (for reserving entire dining rooms for parties).

### Adoption example: Shopping cart

A physical cart gives a shopper a place to gather possible purchases, keep them together while deciding, revise the selection, and purchase the chosen items together. An online store can preserve that course of action without copying the basket, wheels, or aisles. Shoppers already understand that a cart holds a provisional selection. A faithful online cart preserves that revisable selection and the later choice to purchase it together. The designer can use those expectations instead of teaching a new course of action.

> **concept** Shopping
> **purpose** let shopper gather items for purchase and postpone committing; prevents being forced to decide before all options are considered
> **principle** shopper adds and removes items from a cart; when they are ready to purchase the items in the cart, they can order them in one go

### Adaptation example: Email triage

Your usual way of handling incoming email is to read each unread email in turn, and either reply to it or just to archive it. This activity takes too much time and effort, and you find that it's not spent well: very few of the emails actually require a throughtful response. So you adapt the activity by incorporating an agentic step: an agent proposes a response to each email, and you either send it off as is, or edit the response manually.

> **concept** Emailing
> **purpose** respond to emails in a timely fashion; prevents emails from accumulating without response
> **principle** every morning, you read each unread email, optionally reply to it , and archive it or delete it.

> **concept** EmailingWithAgent
> **purpose** respond to emails in a timely fashion; prevents emails from accumulating without response, and avoids spending time on emails that don't require judgment
> **principle** as emails come in, the agent formulates a proposed response and action (delete or archive); every morning, you take each unread email, and either accept the proposed treatment, or override it by manually editing reply text and deciding whether to delete or archive.

### Innovation example: Layering

An artist paints a figure over a sky, then decides that the sky is too dark. She keeps the figure and sky as separate layers in an ordered stack, with the figure rendered above the sky. An adjustment between them lightens the sky without rewriting its stored pixels or changing the figure. She can revise or remove the adjustment and see the composite update.

This course of action is the Layering concept that was invented for Adobe Photoshop, and that was largely responsible for the product's advantage over its competitors. It had precedent in and drew inspiration from the physical overlays that graphical designers used, but the course of action was mostly new, because it included not only simple layering of content but also the addition of masks and adjustments.

The resulting concept can be outlined without the particulars of painting:

> **concept** Layering
> **purpose** allow non-destructive, partial edits of an image; prevents one edit from affecting another and being irreversible
> **principle** an image is constructed by adding layers in a stack one on top of another, which either introduce content or transform the content below; you can also add a mask to a layer that determines what portion of the image it affects.

Content and transformations are both layers when they occupy a position in the visual stack and contribute to the rendered result. The masks of different layers can overlap, so a given layer does not always control its own area within the image, and the result depends on the combination of layers. The concept therefore promises separate representation and revisability rather than full independence of layers.

## Generalizing concepts

When formulating a concept initially, it can be helpful to record it in its most specific form, with all the details of a particular situation. This makes it easy to understand for people familiar with the situation.

The downside is that the concept as formulated may be tied unnecessarily to that situation. Generalizing it can allow it to be applied in other situations. Also, the more general form can actually make it easier to comprehend because it becomes simpler without the application-specific details.

### Generalization example: from emailing to agentic drafting

The emailing example above motivates the concept design but clearly the same strategy could be applied in different contexts. What's important about the course of action is that the agent prepares a proposal for handling each incoming email, and the human user accepts the proposal or overrides it. That pattern could be applied for any work that comes in a queue of items, not just email messages.

Here is how the concept might be generalized:

> **concept** AgenticDefaulting
> **purpose** handle a queue of work items in a timely fashion; prevents items from accumulating, and avoids cost of human processing of items that don't require judgment
> **principle** as new items appear in the queue, the agent formulates a proposed action and response; the human user then reviews each proposal and accepts or overrides it.

Generalization can reveal new design opportunities. In this case, the generalization makes it clear that two different things are going on. One involves the proposed action, and the other the content of the response. The awkwardness of talking about the "response" in the generalized form pointed to this distinction.

Within the emailing context, both aspects (deciding whether to archive or delete the email, and creating a response) seemed compelling and connected. But the connectedness is an artifact of how users tend to handle email. A better design might separate these two aspects, with an AgenticTriaging concept in which an agent proposes what should be done with an incoming email (whether to reply, whether to archive or delete), and an AgenticDrafting concept in which an agent drafts textual content for some purpose (in this case responding to a message). Separating these would result in concepts that can be applied more widely, since in many cases you might want one and not the other.

Furthermore, the separation is likely to lead to richer and more flexible designs even when both concepts are present. In the email context, the user could use AgenticTriaging only on incoming emails, but could use AgenticDrafting both for responses and for emails composed afresh.

## Happy paths only, but happy depends on the purpose

The concept principle describes only the "happy path" that is the expected usage scenario, and not a "sad path" or exceptional case. But this doesn't mean that the principle should never include "negative" actions such as deletions, cancellations, expirations, and so on. The criterion is whether or not such actions support the concept purpose.

### Examples: Happy path with negative step

The Trashing concept (as introduced by Apple for the Lisa, and now widely used in many apps), makes deletions undoable by staging them so the item is first placed in a trash can and only permanently deleted by emptying the trash. Deletion is central to this concept and so both scenarios, restoring and emptying, define the essential behavior.

> **concept** Trashing
> **purpose** allow deletions of items to be undone; prevents accidental deletions from being permanent
> **principle** when you delete an item, it is placed in the trash, from where you can restore it; if you empty the trash instead, the item is permanently deleted and storage is reclaimed.

The HoldingBooking concept is offered by some airlines to mitigate the bad situation of being forced to pay for an item to ensure you get it while it's available even if you're unsure about it. The principle includes the scenario in which the hold expires and the booking is lost. This isn't a sad path; it's exactly what the concept is designed for.

> **concept** HoldingBooking
> **purpose** let you book something while available and buy later; prevents losing the booking or being forced to buy immediately
> **principle** when considering purchasing an item, you can *hold* it without buying, obtaining a booking with a limited lifetime; if you *buy* before the booking *expires*, the item will still be available; if it *expires* before you *buy*, you lose the booking but no payment or cancellation is needed.

### Example: Unhappy path not to include

In contrast, consider cancelling in the Reserving concept, as used in restaurant reservation systems:

> **concept** Reserving
> **purpose** let you reserve a resource in advance so it will be available; prevents wanting to use a resource and finding it unavailable
> **principle** you reserve a resource for a particular date and time in the future, and can redeem it at that date and time and then make use of it.

Realizations of this concept usually allow you to cancel your reservation, sometimes with a fee. But this ability to cancel is not an essential part of the Reserving concept. Unlike the HoldingBooking concept, for which dropping the booking (implicitly on expiry) is an expectation that motivates use of the concept, cancelling is not an expectation when reserving a restaurant table, because when you reserve, you do not expect to cancel.

## Evaluating and comparing concepts

The standard form for concept outlines makes it easier to evaluate concepts and compare them to each other:

- **Evaluating concepts**. Being forced to articulate a principle makes the designer say concretely what the concept does, so they can't hide behind vague insinuations. The purpose raises the stakes even higher, demanding that the designer explain why the behavior exists and what bad situation it addresses. In much design work, this kind of rationale is missing, or is given only for the design as a whole, and not mapped in a granular way to the design elements.
- **Comparing concepts**. Separating out the purposes and principles lets you compare two different concepts and discover that they share the same purpose but different principles, or they have apparently similar principles but actually fulfill different purposes.

### Example of comparing: authentication concepts

Users are often confused by the bewildering array of different concepts used for authentication. Often they appear to have similar principles, but actually serve different purposes.

Consider these examples of concepts for authenticating:

> **concept** **PasswordAuthenticating**
> **purpose** identify users, and to prevent one user from masquerading as another
> **principle** the user registers with a username and password, and then authenticates by entering the same username and password

> **concept** **PasskeyAuthenticating**
> **purpose** identify users, and to prevent one user from masquerading as another, even if they can steal personal data
> **principle** the system generates a key pair, and saves the private key with the user and the public key with the service; the service then sends a challenge for the user to respond to using the private key

> **concept** **RecoveryCodeAuthenticating**
> **purpose** allow users to authenticate when they have lost other credentials, and to prevent them from being locked out
> **principle** the service generates some codes and gives them to the user who can then use them to authenticate themselves just once

> **concept** **AccessTokenSharing**
> **purpose** grant access to third parties, and to mitigate the damage from a third party who is untrustworthy
> **principle** the user generates a token that they can share with the third party so they can obtain access to their account, and can then revoke that token while other tokens they have shared remain active

The purposes show exactly where the concepts differ:

- PasswordAuthenticating and PasskeyAuthenticating have almost the same purpose; the only difference is that pass keys can't be stolen so easily, so they mitigate a broader range of bad situations.
- RecoveryCodeAuthenticating expressly addresses the situation of a user losing other means of authenticating; that's why the principle is able to offer the limited functionality of authenticating just once per code.
- AccessTokenSharing actually isn't about authenticating at all: the third party that accesses your account isn't pretending to be you.

The principles show how the designs of the concepts fulfill their purposes:

- PasskeyAuthenticating has the elaborate key pair mechanism to prevent replay attacks and to avoid the use of passwords.
- RecoveryCodeAuthenticating makes the codes one-time only, so that they serve the purpose of a backup means of access without undermining security.
- AccessTokenSharing differs from PasswordAuthenticating and PasskeyAuthenticating in allowing the user to generate multiple credentials that can be selectively revoked, supporting the purpose of dealing with untrustworthy parties (by being able to stop them from access the account in a granular way).

### Example of comparing: Inviting vs Proposing concepts

Two concepts with similar principles may have very different purposes. Trying to merge the two into one on account of their similar principles is usually a mistake, because even if the principles start out similar they are likely to diverge as the concepts evolve.

For example, consider these two concepts:

> **concept** **Inviting**
> **purpose** obtain agreement in advance on participating in some engagement; prevent participation from being forced or happening without consent
> **principle** one party invites another party to participate in some engagement; the other party can accept or reject; the initial party can also withdraw the invitation if it has not yet been accepted or rejected

> **concept** Proposing
> **purpose** bind two parties to a mutual agreement; prevent either party from subsequently recanting
> **principle** one party proposes an agreement to the other party, who accepts or rejects it; the initial party can also withdraw the proposal if it has not yet been accepted or rejected

Inviting is the concept used when inviting guests to a party, or to join a chat group, for example. Proposing is the concept used when agreeing on a legal contract to buy a house, for example.

Note that the principles seem to be identical: both involve an offer from one party (invite or propose) followed by response (accept or reject), and in both cases, the initiator can withdraw if the other party has yet to respond.

But these concepts have such different purposes that the detailed behavior (in all possible situations) and even the principles are likely to diverge. For example:

- **Changing decisions**. It would be within the spirit of the Inviting concept to allow the recipient to change their mind and accept an invitation they previously rejected, and vice versa. But it would not be appropriate in the Proposing concept for the second party to change their mind, especially accepting and then rejecting. The reason is in the purpose: the purpose of Proposing is precisely to bind the parties on agreement, implying that they will not be able to change their minds.
- **Who accepts**. In Proposing, because the agreement is mutual and requires consent of both parties, the principle might be adjusted to require an explicit acceptance from the proposing party. This wouldn't make sense in the Inviting concept, because acceptance does not represent a symmetric contract but rather an indication from the second party about whether they intend to participate.
- **Multiple parties**. In Inviting, it is expected that the inviter invites multiple parties to participate independently; one invitation and acceptance is not dependent on another. But in Proposing, if multiple parties are involved in a single proposal, the proposal might not be deemed active until all the parties have accepted.
