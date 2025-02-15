---
title: Advanced
description: Advanced usage as well as tips, tricks, and best practices
---

# Advanced usage

Advanced usage and various topics.

## Data fetching

Fetching data can be done simply and safely using an **automatically-typed fetch wrapper**:

- [openapi-fetch](/openapi-fetch/) (recommended)
- [openapi-typescript-fetch](https://www.npmjs.com/package/openapi-typescript-fetch) by [@ajaishankar](https://github.com/ajaishankar)

::: tip

A good fetch wrapper should **never use generics.** Generics require more typing and can hide errors!

:::

## Testing

One of the most common causes of false positive tests is when mocks are out-of-date with the actual API responses.

`openapi-typescript` offers a fantastic way to guard against this with minimal effort. Here’s one example how you could write your own helper function to typecheck all mocks to match your OpenAPI schema (we’ll use [vitest](https://vitest.dev/)/[vitest-fetch-mock](https://www.npmjs.com/package/vitest-fetch-mock) but the same principle could work for any setup):

Let’s say we want to write our mocks in the following object structure, so we can mock multiple endpoints at once:

```
{
  [pathname]: {
    [HTTP method]: { status: [status], body: { …[some mock data] } };
  }
}
```

Using our generated types we can then infer **the correct data shape** for any given path + HTTP method + status code. An example test would look like this:

::: code-group

```ts [my-test.test.ts]
import { mockResponses } from "../test/utils";

describe("My API test", () => {
  it("mocks correctly", async () => {
    mockResponses({
      "/users/{user_id}": {
        // ✅ Correct 200 response
        get: { status: 200, body: { id: "user-id", name: "User Name" } },
        // ✅ Correct 403 response
        delete: { status: 403, body: { code: "403", message: "Unauthorized" } },
      },
      "/users": {
        // ✅ Correct 201 response
        put: { 201: { status: "success" } },
      },
    });

    // test 1: GET /users/{user_id}: 200
    await fetch("/users/user-123");

    // test 2: DELETE /users/{user_id}: 403
    await fetch("/users/user-123", { method: "DELETE" });

    // test 3: PUT /users: 200
    await fetch("/users", {
      method: "PUT",
      body: JSON.stringify({ id: "new-user", name: "New User" }),
    });

    // test cleanup
    fetchMock.resetMocks();
  });
});
```

:::

_Note: this example uses a vanilla `fetch()` function, but any fetch wrapper—including [openapi-fetch](/openapi-fetch/)—could be dropped in instead without any changes._

And the magic that produces this would live in a `test/utils.ts` file that can be copy + pasted where desired (hidden for simplicity):

<details>
<summary>📄 <strong>test/utils.ts</strong></summary>

::: code-group [test/utils.ts]

```ts
import { paths } from "./api/v1/my-schema"; // generated by openapi-typescript

// Settings
// ⚠️ Important: change this! This prefixes all URLs
const BASE_URL = "https://myapi.com/v1";
// End Settings

// type helpers — ignore these; these just make TS lookups better
type FilterKeys<Obj, Matchers> = {
  [K in keyof Obj]: K extends Matchers ? Obj[K] : never;
}[keyof Obj];
type PathResponses<T> = T extends { responses: any } ? T["responses"] : unknown;
type OperationContent<T> = T extends { content: any } ? T["content"] : unknown;
type MediaType = `${string}/${string}`;
type MockedResponse<T, Status extends keyof T = keyof T> = FilterKeys<
  OperationContent<T[Status]>,
  MediaType
> extends never
  ? { status: Status; body?: never }
  : {
      status: Status;
      body: FilterKeys<OperationContent<T[Status]>, MediaType>;
    };

/**
 * Mock fetch() calls and type against OpenAPI schema
 */
export function mockResponses(responses: {
  [Path in keyof Partial<paths>]: {
    [Method in keyof Partial<paths[Path]>]: MockedResponse<
      PathResponses<paths[Path][Method]>
    >;
  };
}) {
  fetchMock.mockResponse((req) => {
    const mockedPath = findPath(
      req.url.replace(BASE_URL, ""),
      Object.keys(responses),
    )!;
    // note: we get lazy with the types here, because the inference is bad anyway and this has a `void` return signature. The important bit is the parameter signature.
    if (!mockedPath || (!responses as any)[mockedPath])
      throw new Error(`No mocked response for ${req.url}`); // throw error if response not mocked (remove or modify if you’d like different behavior)
    const method = req.method.toLowerCase();
    if (!(responses as any)[mockedPath][method])
      throw new Error(`${req.method} called but not mocked on ${mockedPath}`); // likewise throw error if other parts of response aren’t mocked
    if (!(responses as any)[mockedPath][method]) {
      throw new Error(`${req.method} called but not mocked on ${mockedPath}`);
    }
    const { status, body } = (responses as any)[mockedPath][method];
    return { status, body: JSON.stringify(body) };
  });
}

// helper function that matches a realistic URL (/users/123) to an OpenAPI path (/users/{user_id}
export function findPath(
  actual: string,
  testPaths: string[],
): string | undefined {
  const url = new URL(
    actual,
    actual.startsWith("http") ? undefined : "http://testapi.com",
  );
  const actualParts = url.pathname.split("/");
  for (const p of testPaths) {
    let matched = true;
    const testParts = p.split("/");
    if (actualParts.length !== testParts.length) continue; // automatically not a match if lengths differ
    for (let i = 0; i < testParts.length; i++) {
      if (testParts[i]!.startsWith("{")) continue; // path params ({user_id}) always count as a match
      if (actualParts[i] !== testParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return p;
  }
}
```

:::

::: info Additional Explanation

That code is quite above is quite a doozy! For the most part, it’s a lot of implementation detail you can ignore. The `mockResponses(…)` function signature is where all the important magic happens—you’ll notice a direct link between this structure and our design. From there, the rest of the code is just making the runtime work as expected.

:::

```ts
export function mockResponses(responses: {
  [Path in keyof Partial<paths>]: {
    [Method in keyof Partial<paths[Path]>]: MockedResponse<
      PathResponses<paths[Path][Method]>
    >;
  };
});
```

</details>

Now, whenever your schema updates, **all your mock data will be typechecked correctly** 🎉. This is a huge step in ensuring resilient, accurate tests.

## Enum extensions

`x-enum-varnames` can be used to have another enum name for the corresponding value. This is used to define names of the enum items.

`x-enum-descriptions` can be used to provide an individual description for each value. This is used for comments in the code (like javadoc if the target language is java).

`x-enum-descriptions` and `x-enum-varnames` are each expected to be list of items containing the same number of items as enum. The order of the items in the list matters: their position is used to group them together.

Example:

```yaml
ErrorCode:
  type: integer
  format: int32
  enum:
    - 100
    - 200
    - 300
  x-enum-varnames:
    - Unauthorized
    - AccessDenied
    - Unknown
  x-enum-descriptions:
    - "User is not authorized"
    - "User has no access to this resource"
    - "Something went wrong"
```

Will result in:

```ts
enum ErrorCode {
  // User is not authorized
  Unauthorized = 100
  // User has no access to this resource
  AccessDenied = 200
  // Something went wrong
  Unknown = 300
}
```

Alternatively you can use `x-enumNames` and `x-enumDescriptions` ([NSwag/NJsonSchema](https://github.com/RicoSuter/NJsonSchema/wiki/Enums#enum-names-and-descriptions)).

## Tips

In no particular order, here are a few best practices to make life easier when working with OpenAPI-derived types.

### Embrace `snake_case`

Different languages have different preferred syntax styles. To name a few:

- `snake_case`
- `SCREAMING_SNAKE_CASE`
- `camelCase`
- `PascalCase`
- `kebab-case`

TypeScript, which this library is optimized for, uses mostly `camelCase` with some sprinkles of `PascalCase`(classes) and `SCREAMING_SNAKE_CASE` (constants).

However, APIs are language-agnostic, and may contain a different syntax style from TypeScript (usually indiciative of the language of the backend). It’s not uncommon to encounter `snake_case` in object properties. And so it’s tempting for most JS/TS developers to want to enforce `camelCase` on everything for the sake of consistency. But it’s better to **resist that urge** because in addition to being a timesink, it introduces the following maintenance issues:

- ❌ generated types (like the ones produced by openapi-typescript) now have to be manually typed again
- ❌ renaming has to happen at runtime, which means you’re slowing down your application for an invisible change
- ❌ name transformation utilities have to be built & maintained (and tested!)
- ❌ the API probably needs `snake_case` for requestBodies anyway, so all that work now has to be undone for every API request

Instead, treat “consistency” in a more holistic sense, recognizing that preserving the API schema as-written is better than adhering to language-specific style conventions.

### Enable `noUncheckedIndexedAccess`

[Additional Properties](https://swagger.io/docs/specification/data-models/dictionaries/) (a.k.a. dictionaries) generate a type of `Record<string, T>` in TypeScript. TypeScript’s default behavior is a bit dangerous because it will confidently assert a key is there even if you haven’t checked for it. For that reason it’s **highly recommended** to enable `compilerOptions.noUncheckedIndexedAccess` ([docs](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess)) so any `additionalProperties` key will be typed as `T | undefined`.

### Be specific in your schema

openapi-typescript will **never produce an `any` type**. Anything not explicated in your schema may as well not exist. For that reason, always be as specific as possible. Here’s how to get the most out of `additionalProperties`:

<table>
  <thead>
    <tr>
      <td style="width:10%"></td>
      <th scope="col" style="width:40%">Schema</th>
      <th scope="col" style="width:40%">Generated Type</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">
        ❌ Bad
      </th>
      <td>

```yaml
type: object
```

</td>
      <td>

```ts
Record<string, never>;
```

</td>
    </tr>
    <tr>
      <th scope="row">
        ❌ Less Bad
      </th>
      <td>

```yaml
type: object
additionalProperties: true
```

</td>
      <td>

```ts
Record<string, unknown>;
```

</td>
    </tr>
    <tr>
      <th scope="row">
        ✅ Best
      </th>
      <td>

```yaml
type: object
additionalProperties:
  type: string
```

</td>
      <td>

```ts
Record<string, string>;
```

</td>
    </tr>

  </tbody>
</table>

When it comes to **tuple types**, you’ll also get better results by representing that type in your schema. Here’s the best way to type out an `[x, y]` coordinate tuple:

<table>
  <thead>
    <tr>
      <td style="width:10%">&nbsp;</td>
      <th scope="col" style="width:40%">Schema</th>
      <th scope="col" style="width:40%">Generated Type</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">
        ❌ Bad
      </th>
      <td>

```yaml
type: array
```

</td>
      <td>

```ts
unknown[]
```

</td>
    </tr>
    <tr>
      <th scope="row">
        ❌ Less Bad
      </th>
      <td>

```yaml
type: array
items:
  type: number
```

</td>
      <td>

```ts
number[]
```

</td>
    </tr>
    <tr>
      <th scope="row">
        ✅ Best
      </th>
      <td>

```yaml
type: array
items:
  type: number
maxItems: 2
minItems: 2
```

— or —

```yaml
type: array
items:
  type: number
prefixItems:
  - number
  - number
```

</td>
      <td>

```ts
[number, number];
```

</td>
    </tr>

  </tbody>
</table>

### Use `$defs` only in object types

[JSONSchema $defs](https://json-schema.org/understanding-json-schema/structuring.html#defs) can be used to provide sub-schema definitions anywhere. However, these won’t always convert cleanly to TypeScript. For example, this works:

```yaml
components:
  schemas:
    DefType:
      type: object # ✅ `type: "object"` is OK to define $defs on
      $defs:
        myDefType:
          type: string
    MyType:
      type: object
      properties:
        myType:
          $ref: "#/components/schemas/DefType/$defs/myDefType"
```

This will transform into the following TypeScript:

```ts
export interface components {
  schemas: {
    DefType: {
      $defs: {
        myDefType: string;
      };
    };
    MyType: {
      myType?: components["schemas"]["DefType"]["$defs"]["myDefType"]; // ✅ Works
    };
  };
}
```

However, this won’t:

```yaml
components:
  schemas:
    DefType:
      type: string # ❌ this won’t keep its $defs
      $defs:
        myDefType:
          type: string
    MyType:
      properties:
        myType:
          $ref: "#/components/schemas/DefType/$defs/myDefType"
```

Because it will transform into:

```ts
export interface components {
  schemas: {
    DefType: string;
    MyType: {
      myType?: components["schemas"]["DefType"]["$defs"]["myDefType"]; // ❌ Property '$defs' does not exist on type 'String'.
    };
  };
}
```

So be wary about where you define `$defs` as they may go missing in your final generated types. When in doubt, you can always define `$defs` at the root schema level.

### Use `oneOf` by itself

OpenAPI’s composition tools (`oneOf`/`anyOf`/`allOf`) are powerful tools for reducing the amount of code in your schema while maximizing flexibility. TypeScript unions, however, don’t provide [XOR behavior](https://en.wikipedia.org/wiki/Exclusive_or), which means they don’t map directly to `oneOf`. For that reason, it’s recommended to use `oneOf` by itself, and not combined with other composition methods or other properties. e.g.:

#### ❌ Bad

```yaml
Pet:
  type: object
  properties:
    type:
      type: string
      enum:
        - cat
        - dog
        - rabbit
        - snake
        - turtle
    name:
      type: string
  oneOf:
    - $ref: "#/components/schemas/Cat"
    - $ref: "#/components/schemas/Dog"
    - $ref: "#/components/schemas/Rabbit"
    - $ref: "#/components/schemas/Snake"
    - $ref: "#/components/schemas/Turtle"
```

This generates the following type which mixes both TypeScript unions and intersections. While this is valid TypeScript, it’s complex, and inference may not work as you intended. But the biggest offense is TypeScript can’t discriminate via the `type` property:

```ts
  Pet: ({
    /** @enum {string} */
    type?: "cat" | "dog" | "rabbit" | "snake" | "turtle";
    name?: string;
  }) & (components["schemas"]["Cat"] | components["schemas"]["Dog"] | components["schemas"]["Rabbit"] | components["schemas"]["Snake"] | components["schemas"]["Turtle"]);
```

#### ✅ Better

```yaml
Pet:
  oneOf:
    - $ref: "#/components/schemas/Cat"
    - $ref: "#/components/schemas/Dog"
    - $ref: "#/components/schemas/Rabbit"
    - $ref: "#/components/schemas/Snake"
    - $ref: "#/components/schemas/Turtle"
PetCommonProperties:
  type: object
  properties:
    name:
      type: string
Cat:
  allOf:
    - "$ref": "#/components/schemas/PetCommonProperties"
  type:
    type: string
    enum:
      - cat
```

The resulting generated types are not only simpler; TypeScript can now discriminate using `type` (notice `Cat` has `type` with a single enum value of `"cat"`).

```ts
Pet: components["schemas"]["Cat"] | components["schemas"]["Dog"] | components["schemas"]["Rabbit"] | components["schemas"]["Snake"] | components["schemas"]["Turtle"];
Cat: { type?: "cat"; } & components["schemas"]["PetCommonProperties"];
```

_Note: you optionally could provide `discriminator.propertyName: "type"` on `Pet` ([docs](https://spec.openapis.org/oas/v3.1.0#discriminator-object)) to automatically generate the `type` key, but is less explicit._

While the schema permits you to use composition in any way you like, it’s good to always take a look at the generated types and see if there’s a simpler way to express your unions & intersections. Limiting the use of `oneOf` is not the only way to do that, but often yields the greatest benefits.
