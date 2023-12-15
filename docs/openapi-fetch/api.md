---
title: API
description: openapi-fetch API
---

# API

## Create Client

**createClient** accepts the following options, which set the default settings for all subsequent fetch calls.

```ts
createClient<paths>(options);
```

| Name              |      Type       | Description                                                                                                                             |
| :---------------- | :-------------: | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`         |    `string`     | Prefix all fetch URLs with this option (e.g. `"https://myapi.dev/v1/"`)                                                                 |
| `fetch`           |     `fetch`     | Fetch instance used for requests (default: `globalThis.fetch`)                                                                          |
| `querySerializer` | QuerySerializer | (optional) Provide a [querySerializer](#queryserializer)                                                                                |
| `bodySerializer`  | BodySerializer  | (optional) Provide a [bodySerializer](#bodyserializer)                                                                                  |
| (Fetch options)   |                 | Any valid fetch option (`headers`, `mode`, `cache`, `signal` …) ([docs](https://developer.mozilla.org/en-US/docs/Web/API/fetch#options) |

## Fetch options

The following options apply to all request methods (`.GET()`, `.POST()`, etc.)

```ts
client.get("/my-url", options);
```

| Name              |                               Type                                | Description                                                                                                                                                                                                                       |
| :---------------- | :---------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params`          |                           ParamsObject                            | [path](https://swagger.io/specification/#parameter-locations) and [query](https://swagger.io/specification/#parameter-locations) params for the endpoint                                                                          |
| `body`            |                        `{ [name]:value }`                         | [requestBody](https://spec.openapis.org/oas/latest.html#request-body-object) data for the endpoint                                                                                                                                |
| `querySerializer` |                          QuerySerializer                          | (optional) Provide a [querySerializer](#queryserializer)                                                                                                                                                                          |
| `bodySerializer`  |                          BodySerializer                           | (optional) Provide a [bodySerializer](#bodyserializer)                                                                                                                                                                            |
| `parseAs`         | `"json"` \| `"text"` \| `"arrayBuffer"` \| `"blob"` \| `"stream"` | (optional) Parse the response using [a built-in instance method](https://developer.mozilla.org/en-US/docs/Web/API/Response#instance_methods) (default: `"json"`). `"stream"` skips parsing altogether and returns the raw stream. |
| `fetch`           |                              `fetch`                              | Fetch instance used for requests (default: fetch from `createClient`)                                                                                                                                                             |
| `middleware`      |                          `Middleware[]`                           | [See docs](#middleware)                                                                                                                                                                                                           |
| (Fetch options)   |                                                                   | Any valid fetch option (`headers`, `mode`, `cache`, `signal`, …) ([docs](https://developer.mozilla.org/en-US/docs/Web/API/fetch#options))                                                                                         |

### querySerializer

By default, this library serializes query parameters using `style: form` and `explode: true` [according to the OpenAPI specification](https://swagger.io/docs/specification/serialization/#query). To change the default behavior, you can supply your own `querySerializer()` function either on the root `createClient()` as well as optionally on an individual request. This is useful if your backend expects modifications like the addition of `[]` for array params:

```ts
const { data, error } = await GET("/search", {
  params: {
    query: { tags: ["food", "california", "healthy"] },
  },
  querySerializer(q) {
    let s = "";
    for (const [k, v] of Object.entries(q)) {
      if (Array.isArray(v)) {
        s += `${k}[]=${v.join(",")}`;
      } else {
        s += `${k}=${v}`;
      }
    }
    return s; // ?tags[]=food&tags[]=california&tags[]=healthy
  },
});
```

### bodySerializer

Similar to [querySerializer](#querySerializer), bodySerializer allows you to customize how the requestBody is serialized if you don’t want the default [JSON.stringify()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify) behavior. You probably only need this when using `multipart/form-data`:

```ts
const { data, error } = await PUT("/submit", {
  body: {
    name: "",
    query: { version: 2 },
  },
  bodySerializer(body) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) {
      fd.append(k, v);
    }
    return fd;
  },
});
```

## Middleware

As of `0.9.0` this library supports lightweight middleware. Middleware allows you to modify either the request, response, or both for all fetches.

You can declare middleware as an array of functions on [createClient](#create-client). Each middleware function will be **called twice**—once for the request, then again for the response. On request, they’ll be called in array order. On response, they’ll be called in reverse-array order. That way the first middleware gets the first “dibs” on request, and the final control over responses.

Within your middleware function, you’ll either need to check for `req` (request) or `res` (response) to handle each pass appropriately:

```ts
createClient({
  middleware: [
    async function myMiddleware({
      req, // request (undefined for responses)
      res, // response (undefined for requests)
      options, // all options passed to openapi-fetch
    }) {
      if (req) {
        return new Request(req.url, {
          ...req,
          headers: { ...req.headers, foo: "bar" },
        });
      } else if (res) {
        return new Response({
          ...res,
          status: 200,
        });
      }
    },
  ],
});
```

### Request pass

The request pass of each middleware provides `req` that’s a standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) instance, but has 2 additional properties:

| Name         |   Type   | Description                                                      |
| :----------- | :------: | :--------------------------------------------------------------- |
| `schemaPath` | `string` | The OpenAPI pathname called (e.g. `/projects/{project_id}`)      |
| `params`     | `Object` | The [params](#fetch-options) fetch option provided by the client |

### Response pass

The response pass returns a standard [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instance with no modifications.

### Skipping middleware

If you want to skip the middleware under certain conditions, just `return` as early as possible:

```ts
async function myMiddleware({ req }) {
  if (req.schemaPath !== "/projects/{project_id}") {
    return;
  }

  // …
}
```

This will leave the request/response unmodified, and pass things off to the next middleware handler (if any). There’s no internal callback or observer library needed.

### Handling statefulness

When using middleware, it’s important to remember 2 things:

- **Create new instances** when modifying (e.g. `new Response()`)
- **Clone bodies** before accessing (e.g. `res.clone().json()`)

This is to account for the fact responses are [stateful](https://developer.mozilla.org/en-US/docs/Web/API/Response/bodyUsed), and if the stream is consumed in middleware [the client will throw an error](https://developer.mozilla.org/en-US/docs/Web/API/Response/clone).

<!-- prettier-ignore -->
```ts
async function myMiddleware({ req, res }) {
  // Example 1: modifying request
  if (req) {
    res.headers.foo = "bar"; // [!code --]
    return new Request(req.url, { // [!code ++]
      ...req, // [!code ++]
      headers: { ...req.headers, foo: "bar" }, // [!code ++]
    }); // [!code ++]
  }

  // Example 2: accessing response
  if (res) {
    const data = await res.json(); // [!code --]
    const data = await res.clone().json(); // [!code ++]
  }
}
```

### Other notes

- `querySerializer()` runs _before_ middleware
  - This is to save middleware from having to do annoying URL formatting. But remember middleware can access `req.params`
- `bodySerializer()` runs _after_ middleware
  - There is some overlap with `bodySerializer()` and middleware. Probably best to use one or the other; not both together.
