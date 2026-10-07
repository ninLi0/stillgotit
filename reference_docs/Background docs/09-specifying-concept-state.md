# A notation for state declarations in concept specifications

Source: [A notation for state declarations in concept specifications](https://61040.github.io/fa26/background/specifying-concept-state/)  
Downloaded: October 5, 2026

## Purpose

Simple State Form (SSF) is a syntax for data modeling that is designed to be both easy to read (especially by non-technical people) and also easily translatable into a formal database schema (either by an LLM or by a conventional parser). It is intended to be compatible with collection databases (such as MongoDB), relational databases (such as SQLLite), relational modeling languages (such as Alloy), and also graph databases (such as Neo and GraphQL). SSF was motivated by the need for a simple language for state declarations for concepts in concept design.

## Semantic Features

The key semantic features of SSF are: the ability to declare sets of individuals, along with relations that map them to other individuals or primitive values, and subsets of these sets, with additional relations. A basic set of primitive types is provided, as well as enumerations. The language is first-order, so an individidual can be mapped to a set of individuals or scalars, but not to a set of sets. Union types are currently not supported.

## Grammar

- *schema* ::= ( *set-decl* | *subset-decl* | *alias-decl* | *rule* )\*
- *set-decl* ::= [ "a" | "an" ] ("element" | "set" | "seq") [ "of" ] *individual-type* [ "with" ( *field-decl* | *unique-decl* ) + ]
- *subset-decl* ::= [ "a" | "an" ] *subset-name* ("element" | "set") [ "of" ] ( *individual-type* | *sub-type* | *alias-name* ) [ *condition* ] [ "with" ( *field-decl* | *unique-decl* ) + ]
- *field-decl* ::= [ "a" | "an" ] *modifier* \* [ *field-name* ] ( *scalar-type* | *set-type* )
- *modifier* ::= "optional" | "unique"
- *unique-decl* ::= "unique" *field-name* ( "and" *field-name* ) \*
- *scalar-type* ::= *individual-type* | *parameter-type* | *enumeration-type* | *primitive-type* | *alias-name*
- *set-type* ::= ("set" | "seq" ) [ "of" ] *scalar-type*
- *condition* ::= "where" *field-name* "is" *enum-constant* ( "or" *enum-constant* ) \*
- *alias-decl* ::= "alias" *alias-name* "for" ( *individual-type* | *subset-name* )
- *rule* ::= "Rule:" *text*

A rule can stand on its own or be indented beneath the declaration it concerns. Adding a rule does not require `with`, which introduces fields and uniqueness constraints.

An *enumeration-type* is the name of an enumeration declared in the concept's `Types` section. Its declaration has the form:

- *enumeration-decl* ::= *enumeration-type* "is" *enum-constant* ( "or" *enum-constant* ) +

## Grammar conventions

- [ x ] means x is optional
- In ( x ), the parens used for grouping, and do not appear in the actual language
- a | b means either a or b
- x \* means an iteration of zero or more of x
- x + means an iteration of one or more of x

## Grammar constraints

- A *field-name* may be omitted only for declaring a field of *individual-type* or *parameter-type*. Omitting the field name is equivalent to including a name that is the same as the name of the type but with the first character in lower case.
- The hierarchy that is specified by *subset-decls* cannot contain cycles. Thus, a *subset-decl* may not, for example, declare a subset with a *sub-type* that is the same as the *sub-type* that it is a subset of.
- The *field-names* within a *set-decl* or *subset-decl* must be unique. Also, within all the decls that are in the hierarchy beneath a *set-decl*, *field-names* must be unique.

## Grammar constraints

- A *field-name* may be omitted for a field referring to individuals, including external individuals, or a set or sequence of them. The implicit name begins with a lowercase letter and uses the singular form for a scalar and the plural form for a collection, as in `a User` for `a user User` and `a set of Options` for `a options set of Options`.
- The hierarchy that is specified by *subset-decls* cannot contain cycles. Thus, a *subset-decl* may not, for example, declare a subset with a *sub-type* that is the same as the *sub-type* that it is a subset of.
- The *field-names* within a *set-decl* or *subset-decl* must be unique. A *unique-decl* names fields declared there or inherited from a parent.
- A *field-decl* that has a *set-type* cannot use the *optional* keyword, but may use *unique*.
- A scalar *field-decl* may use both *optional* and *unique*, in either order. Each modifier may appear at most once.
- An enumeration declares at least two distinct values. A subset condition tests a scalar enumeration field declared in the subset or inherited from a parent, using values from that enumeration.

## Lexical considerations: identifiers

- The identifiers *enum-constant*, *field-name*, *subset-name*, *individual-type*, *parameter-type*, *enumeration-type* and *primitive-type* are sequences of alphabetic characters, digits and underscores, starting with an alphabetic character. The alphabetic characters in an *enum-constant* must all be uppercase. A *field-name* and *subset-name* must start with a lower case alphabetic character. An *individual-type*, *parameter-type*, *enumeration-type* or *primitive-type* must start with an upper case alphabetic character.
- The standard values from which a *primitive-type* is drawn are "Number", "String", "Flag", "Date", "DateTime".

## Lexical considerations: layout

- The language is whitespace-sensitive to ensure unambiguous parsing
- Each declaration must occupy a single line
- Field declarations and uniqueness constraints must be indented beneath the declarations they belong to
- The singular and plural forms of a state type, such as `User` and `Users`, can refer to the same individuals. To give the type a different name altogether, use an alias.
- Type names must always be capitalized ("User") and field and collection names are not capitalized ("email")
- Enumeration values (and no other names or types) are in uppercase

## Semantics

- Set and subset declarations introduce sets of individuals, named by *individual-types* and *sub-types*. Every member of a subset is expected also to be a member of the corresponding superset. For a regular individual type, adding an individual to a set will typically correspond to creating the individual; in contrast, adding an individual to a subset involves taking an existing individual and making it belong to the subset. A parameter type represents external individuals and can be used as the value type of a field, but does not introduce a set of individuals owned by this concept.
- The subsets of a set can overlap. Subsets offer a way both to classify individuals (in a traditional subtype hierarchy) and also a way to declare relations on existing sets without extending the set declaration.
- When the keyword "element" is used rather than "set" in a set or subset declaration, the declared set is constrained to contain exactly one individual.
- The value of an individual is just its identity, so an individual should not be thought of as a composite. But it is convenient to group the relations associated with an individual as if they were properties of the individual. It is important to understand that grouping the relations as 'fields' of an individual is just a way to simplify the notation and does not imply that the individual is an 'object' in the object-oriented sense that 'contains' its fields.
- Every field can be viewed as a relation that maps an individual to a set of values that may be empty or may contain a single value or multiple values. An optional scalar field corresponds to the empty case. A field with a set type should *not* be declared as optional; instead an empty set should be used when there is no value to map to.
- When a field is marked as unique, no two members of the declaration may have the same value for that field. If the field is also optional, several members may have no value, but any values that are present must be distinct. For a collection field, this means that no two members have exactly the same set or sequence, although their collections may share elements.
- A constraint such as `unique item and voter` makes the combination of field values unique, allowing either field to have repeated values on its own. When a uniqueness constraint appears on a subset, it applies only to the members of that subset.
- The keyword `seq` is used in place of `set` when the order of the elements matters. It can be used for a field or for a top-level declaration such as `a seq of Entries`, but subsets are declared with `set` or `element`.
- An alias gives another name to an existing state declaration or subset without introducing any new individuals. The new name must begin with an uppercase letter and be different from the other type names. You can place the alias before or after the declaration it names, but it must refer to that declaration directly rather than through another alias.
- A `Rule:` line lets you write a constraint in prose when it is awkward or impossible to express in the notation. Like other constraints on the state, a rule must be preserved by the actions, so their definitions need to account for it.

## Examples

A set of users, each with a username and password, both strings:

```
a set of Users with
  a username String
  a password String
```

A set of users each with a unique username:

```
a set of Users with
  a unique username String
```

A set of users whose usernames are optional, but distinct when present:

```
a set of Users with
  an optional unique username String
```

A set of votes, with at most one vote per item and voter, allowing many users to vote for the same item and a user to vote for many items, while allowing at most one recorded vote for each user and item:

```
a set of Votes with
  an item Item
  a voter User
  unique item and voter
```

A set of users, each with a set of followers who are users:

```
a set of Users with
  a followers set of Users
```

A set of users, each with a profile (using the ability to omit a field name, so that the implicit field name is "profile"):

```
a set of Users with
  a Profile
```

A set of users with a status that is enumerated. First name the enumeration in the concept's `Types` section:

```
UserStatus is PENDING or REGISTERED
```

Then use that name in the state declaration:

```
a set of Users with
  a status UserStatus
```

We can extend this state with a subset containing the users whose status is `PENDING`:

```
a pending set of Users where status is PENDING
```

Here, membership in `Pending` is determined by the user's status. To include several possible status values, list them in the condition separated by `or`. A subset can also have no condition, as in the banned-user example below, in which case the concept records membership separately.

An ordered collection of entries:

```
a seq of Entries with
  a text String
```

Another name for a declared type, where `Member` and `Users` refer to the same individuals:

```
a set of Users
alias Member for Users
```

A singleton set used for global settings

```
an element GlobalSettings with
  a deployed Flag
  an applicationName String
  an apiKey String
```

A set of users, and a subset that have been banned on a particular date and by a particular user:

```
a set of Users with
  a username String
  a password String

a banned set of Users with
  a bannedOn Date
  a bannedBy User
```

A subset without any relations:

```
a set of Users with
  a username String
  a password String

a banned set of Users
```

A set of items, classified into books and movies:

```
a set of Items with
  a title String
  a created Date

a books set of Items with
  an isbn String
  a pageCount Number
  an author Person
  
a movies set of Items with
   an imdb String
   a director String 
   an actors set of Persons
```

A mapping defined separately on a set, using a subset (defining a relation called *followers* mapping users in the subset *Followed* to users):

```
a set of Users with
  a username String
  a password String
  
a Followed set of Users with
  a followers set of Users
```

An implicitly named field (called *profile*, relating *Users* to *Profiles*)

```
a set of Users with 
  a Profile
```

An implicitly named set-typed field (called *options*, relating *Questions* to Options)

```
a set of Questions with 
  a set of Options
```

A model of a simple folder scheme in which folders and files have names:

```
a set of Folders with
  an optional parent Folder
  a name String
  
a rootFolder element of Folder

a set of Files with 
  a Folder
  a name String
```

A model of a Unix like scheme in which names are local to directories:

```
a set of FileSystemObjects

a files set of FileSystemObjects

a directories set of FileSystemObjects with
  a set of Entries
  
a rootDirectory element of Directories

a set of Entries with
  a name String
  a member FileSystemObject
```
