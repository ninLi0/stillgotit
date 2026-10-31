# Archiving

## Purpose

Let a person set aside the items they are done with, so the lists they use every day stay short, and bring any of them back later, without changing or losing the items themselves.

## Principle

An application lists Maya's conversations, newest first, and she is done with an old one about transposes, so she archives it. Archiving now remembers that Maya archived that conversation and when she did, so the application leaves it out of her everyday list and shows it among her archived items instead. Sam has archived nothing, and Maya's choice is hers alone. The reply to Maya's request was lost, so her browser sends it again; nothing changes, and the conversation keeps the time it was first archived. A week later she wants to review transposes, so she restores the conversation. Archiving forgets it, and the application lists it with her other conversations again. Restoring it a second time changes nothing. Archiving never read or changed the conversation, so everything in it is exactly as it was before she archived it.

## Types

```types
external User
  The person who archives items.
external Item
  One of the person's things that an application lists, such as a conversation. Archiving stores it as a key and never reads it.
opaque ItemSet
  A finite set of Item identities, with no duplicates or ordering.
```

## State

```state
a set of ArchivedItems with
  an owner User
  an item Item
  an archivedAt DateTime
  unique owner and item

Rule: an archived item exists exactly when its owner archived the item and has not restored it since. archivedAt is the server time of that archive; archiving an item that is already archived keeps its archivedAt.
Rule: Archiving never reads or changes an item. What being archived means for an item, such as leaving it out of a list or showing it without the controls that change it, is decided by the application.
Rule: Archiving trusts the user it is given. The application supplies the signed-in user, never one named in a request, and checks that the item is that user's before it calls archive or restore.
Rule: archive and restore each make at most one write, keyed by the owner and the item. When two archives of the same item arrive together, one adds the archived item and the other finds it and changes nothing.
Rule: now is server time. Unmentioned state stays unchanged.
```

## Actions

```actions
archive(owner: User, item: Item) : returns ()
  where the owner has an archived item for the item
  then
    returns
  where the owner has no archived item for the item
  then
    add an archived item with owner, item, and archivedAt now
    returns

restore(owner: User, item: Item) : returns ()
  where the owner has no archived item for the item
  then
    returns
  where the owner has an archived item for the item
  then
    remove that archived item
    returns
```

## Queries

```queries
_archived(owner: User, item: Item) : optional (archivedAt: DateTime)
  answers when the owner archived the item
  answers no row when the owner has no archived item for the item

_items(owner: User) : many (item: Item, archivedAt: DateTime)
  answers one row for each item the owner has archived, with when it was archived
  orders the rows most recently archived first, and items archived at the same time by item
  answers no rows when the owner has archived nothing

_itemSet(owner: User) : one (items: ItemSet)
  answers every item the owner has archived as one set, ordered by item, or an empty set
```
