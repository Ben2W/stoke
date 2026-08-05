# @usestoke/provider-browser

Expose workflow operations that open an HTTP or HTTPS URL on the current Stoke host.

```ts
await providers.browser.open({
  url: "https://example.com",
  displayName: "Open development preview",
});
```

The promise resolves after the current host acknowledges that it opened the URL.
