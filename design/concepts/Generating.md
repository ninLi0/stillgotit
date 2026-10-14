# Generating

## Purpose

Produce a structured answer with an external service.

## Principle

A caller provides an owner and a prepared request. The provider either returns an answer or reports failure. It does not change the caller's domain records. A retry can repeat external work.

## Types

```types
external Owner
  The identity whose provider connection is used.
external Request
  Prepared input for the provider.
external Answer
  A validated provider answer.
```

## State

```state
Rule: this concept keeps no durable state. The caller supplies all request content and retains any answer it needs.
```

## Actions

```actions
generate(owner: Owner, request: Request) : returns (answer: Answer)
  where the provider completes the request with a valid answer
  then
    returns answer
  where the provider is unavailable, fails, or returns invalid content
  then
    refuses GENERATION_FAILED "The tutor could not finish. Check your connection and retry. Your saved work is still available."
```

## Queries

```queries
```
