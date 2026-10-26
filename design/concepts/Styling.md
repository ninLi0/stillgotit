# Styling

## Purpose

Remember the look a person chose for each of their items, so the choice follows them to every device and no request has to carry it.

## Principle

An application draws each of a person's topics as a tree and offers several kinds of tree, such as oak, willow, and pine. Maya has two topics, Vectors and Matrices, and has chosen nothing, so Styling returns no style for either of them, and the application draws each topic with its own default kind. On her laptop she chooses willow for Vectors. That evening she signs in on her phone, and Styling returns willow for Vectors there too, while Matrices still has no style. Sam chose nothing; Maya's choice is hers alone. Maya chooses pine for Matrices, and Styling now lists both of her items with their styles. The reply to that choice was lost, so her laptop sends pine for Matrices again, and nothing changes. Later she chooses oak for Vectors, which replaces willow and leaves Matrices as it was. Finally she clears Vectors. Styling again returns no style for Vectors, the application's default applies to it, and Matrices keeps pine. Clearing Vectors a second time changes nothing.

## Types

```types
external User
  The person whose choices are remembered.
external Item
  One of the person's things that the application draws, such as a topic. Styling stores it as a key and never reads it.
external Style
  A look the application offered and validated. Styling stores and returns it unchanged and never interprets it.
```

## State

```state
a set of StyledItems with
  an owner User
  an item Item
  a style Style
  unique owner and item

Rule: a styled item exists exactly when its owner has a remembered style for that item, and each owner and item pair has one style at a time.
Rule: Styling does not know which styles are offered. The application validates a style before calling choose, and validates a remembered style again before using it, because the offer can change after a choice is saved.
Rule: Styling trusts the user it is given. The application supplies the signed-in user, never a user named in a request, and checks that the item is that user's before calling choose or clear.
Rule: choose and clear each make one write keyed by the owner and the item, so concurrent calls for the same owner and item leave the result of whichever write came last. A remembered style never expires; it lasts until its owner changes or clears it.
```

## Actions

```actions
choose(owner: User, item: Item, style: Style) : returns ()
  where true
  then
    make style the owner's style for the item, adding a styled item or replacing the earlier style
    returns

clear(owner: User, item: Item) : returns ()
  where the owner has no styled item for the item
  then
    returns
  where the owner has a styled item for the item
  then
    remove that styled item
    returns
```

## Queries

```queries
_style(owner: User, item: Item) : optional (style: Style)
  answers the owner's remembered style for the item
  answers no row when the owner has no remembered style for the item

_styles(owner: User) : many (item: Item, style: Style)
  answers one row for each item that the owner has a remembered style for, with that style
  answers no rows when the owner has remembered no style
  orders the rows by item
```
