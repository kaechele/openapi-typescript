// settings & const
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

/**
 * Create an openapi-fetch client.
 * @type {import("./index.js").default}
 */
export default function createClient(clientOptions) {
  const {
    fetch: baseFetch = globalThis.fetch,
    querySerializer: globalQuerySerializer,
    bodySerializer: globalBodySerializer,
    middleware,
    ...baseOptions
  } = clientOptions ?? {};
  let baseUrl = baseOptions.baseUrl ?? "";
  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1); // remove trailing slash
  }

  /**
   * Per-request fetch (keeps settings created in createClient()
   * @param {T} url
   * @param {import('./index.js').FetchOptions<T>} fetchOptions
   */
  async function coreFetch(url, fetchOptions) {
    let {
      fetch = baseFetch,
      headers,
      params = {},
      parseAs = "json",
      querySerializer = globalQuerySerializer ?? defaultQuerySerializer,
      bodySerializer = globalBodySerializer ?? defaultBodySerializer,
      ...init
    } = fetchOptions || {};

    let request = new Request(
      createFinalURL(url, { baseUrl, params, querySerializer }),
      {
        redirect: "follow",
        ...baseOptions,
        ...init,
        headers: mergeHeaders(
          DEFAULT_HEADERS,
          clientOptions?.headers,
          headers,
          params.header,
        ),
      },
    );

    // middleware (request)
    const mergedOptions = {
      baseUrl,
      fetch,
      parseAs,
      querySerializer,
      bodySerializer,
    };
    if (Array.isArray(middleware)) {
      for (const m of middleware) {
        const req = new Request(request.url, request);
        req.schemaPath = url; // (re)attach original URL
        req.params = params; // (re)attach params
        const result = await m({
          type: "request",
          req,
          options: Object.freeze({ ...mergedOptions }),
        });
        if (result) {
          if (!(result instanceof Request)) {
            throw new Error(
              `Middleware must return new Request() when modifying the request`,
            );
          }
          request = result;
        }
      }
    }

    // fetch!
    // if (init.body) {
    //   request = new Request(request.url, {
    //     ...request,
    //     body: bodySerializer(init.body),
    //   });
    // }
    // remove `Content-Type` if serialized body is FormData; browser will correctly set Content-Type & boundary expression
    // if (request.body instanceof FormData) {
    //   request.headers.delete("Content-Type");
    // }

    let response = await fetch(request);

    // middleware (response)
    if (Array.isArray(middleware)) {
      // execute in reverse-array order (first priority gets last transform)
      for (let i = middleware.length - 1; i >= 0; i--) {
        const result = await middleware[i]({
          type: "response",
          res: response,
          options: Object.freeze({ ...mergedOptions }),
        });
        if (result) {
          if (!(result instanceof Response)) {
            throw new Error(
              `Middleware must return new Response() when modifying the response`,
            );
          }
          response = result;
        }
      }
    }

    // handle empty content
    // note: we return `{}` because we want user truthy checks for `.data` or `.error` to succeed
    if (
      response.status === 204 ||
      response.headers.get("Content-Length") === "0"
    ) {
      return response.ok ? { data: {}, response } : { error: {}, response };
    }

    // parse response (falling back to .text() when necessary)
    if (response.ok) {
      // if "stream", skip parsing entirely
      if (parseAs === "stream") {
        // fix for bun: bun consumes response.body, therefore clone before accessing
        // TODO: test this?
        return { data: response.clone().body, response };
      }
      const cloned = response.clone();
      return {
        data:
          typeof cloned[parseAs] === "function"
            ? await cloned[parseAs]()
            : await cloned.text(),
        response,
      };
    }

    // handle errors (always parse as .json() or .text())
    let error = {};
    try {
      error = await response.clone().json();
    } catch {
      error = await response.clone().text();
    }
    return { error, response };
  }

  return {
    /** Call a GET endpoint */
    async GET(url, init) {
      return coreFetch(url, { ...init, method: "GET" });
    },
    /** Call a PUT endpoint */
    async PUT(url, init) {
      return coreFetch(url, { ...init, method: "PUT" });
    },
    /** Call a POST endpoint */
    async POST(url, init) {
      return coreFetch(url, { ...init, method: "POST" });
    },
    /** Call a DELETE endpoint */
    async DELETE(url, init) {
      return coreFetch(url, { ...init, method: "DELETE" });
    },
    /** Call a OPTIONS endpoint */
    async OPTIONS(url, init) {
      return coreFetch(url, { ...init, method: "OPTIONS" });
    },
    /** Call a HEAD endpoint */
    async HEAD(url, init) {
      return coreFetch(url, { ...init, method: "HEAD" });
    },
    /** Call a PATCH endpoint */
    async PATCH(url, init) {
      return coreFetch(url, { ...init, method: "PATCH" });
    },
    /** Call a TRACE endpoint */
    async TRACE(url, init) {
      return coreFetch(url, { ...init, method: "TRACE" });
    },
  };
}

// utils

/**
 * Serialize query params to string
 * @type {import("./index.js").defaultQuerySerializer}
 */
export function defaultQuerySerializer(q) {
  const search = [];
  if (q && typeof q === "object") {
    for (const [k, v] of Object.entries(q)) {
      const value = defaultQueryParamSerializer([k], v);
      if (value) {
        search.push(value);
      }
    }
  }
  return search.join("&");
}

/**
 * Serialize query param schema types according to expected default OpenAPI 3.x behavior
 * @type {import("./index.js").defaultQueryParamSerializer}
 */
export function defaultQueryParamSerializer(key, value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return `${deepObjectPath(key)}=${encodeURIComponent(value)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${deepObjectPath(key)}=${String(value)}`;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return undefined;
    }
    const nextValue = [];
    for (const item of value) {
      const next = defaultQueryParamSerializer(key, item);
      if (next !== undefined) {
        nextValue.push(next);
      }
    }
    return nextValue.join(`&`);
  }
  if (typeof value === "object") {
    if (!Object.keys(value).length) {
      return undefined;
    }
    const nextValue = [];
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        const next = defaultQueryParamSerializer([...key, k], v);
        if (next !== undefined) {
          nextValue.push(next);
        }
      }
    }
    return nextValue.join("&");
  }
  return encodeURIComponent(`${deepObjectPath(key)}=${String(value)}`);
}

/**
 * Flatten a node path into a deepObject string
 * @type {import("./index.js").deepObjectPath}
 */
function deepObjectPath(path) {
  let output = path[0];
  for (const k of path.slice(1)) {
    output += `[${k}]`;
  }
  return output;
}

/**
 * Serialize body object to string
 * @type {import("./index.js").defaultBodySerializer}
 */
export function defaultBodySerializer(body) {
  return JSON.stringify(body);
}

/**
 * Construct URL string from baseUrl and handle path and query params
 * @type {import("./index.js").createFinalURL}
 */
export function createFinalURL(pathname, options) {
  let finalURL = `${options.baseUrl}${pathname}`;
  if (options.params.path) {
    for (const [k, v] of Object.entries(options.params.path)) {
      finalURL = finalURL.replace(`{${k}}`, encodeURIComponent(String(v)));
    }
  }
  const search = options.querySerializer(options.params.query ?? {});
  if (search) {
    finalURL += `?${search}`;
  }
  return finalURL;
}

/**
 * Merge headers a and b, with b taking priority
 * @type {import("./index.js").mergeHeaders}
 */
export function mergeHeaders(...allHeaders) {
  const headers = new Headers();
  for (const headerSet of allHeaders) {
    if (!headerSet || typeof headerSet !== "object") {
      continue;
    }
    const iterator =
      headerSet instanceof Headers
        ? headerSet.entries()
        : Object.entries(headerSet);
    for (const [k, v] of iterator) {
      if (v === null) {
        headers.delete(k);
      } else if (v !== undefined) {
        headers.set(k, v);
      }
    }
  }
  return headers;
}
