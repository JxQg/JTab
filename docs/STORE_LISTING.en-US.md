# JTab Store Listing (English)

## Name

JTab - Bookmark New Tab

## Short description

A modern, private new tab powered by browser bookmarks, with nested folders, backgrounds, and custom CSS.

## Detailed description

JTab turns the bookmarks already stored in your browser into a clear, responsive, and customizable new tab page. No account is required, and your bookmarks are never uploaded to a cloud service.

Key features:

- Organize selected folders as top-level entries, then expand nested folders inline at any depth.
- Choose exactly which folders to show, including direct items or complete subtrees.
- Open settings inside the new tab page instead of navigating to the browser's extension manager.
- Switch between detailed cards and square icon tiles, with independent collection opacity, blur, bookmark-card opacity, and per-layout card radii.
- See the active search provider in the search box and switch providers in place.
- Use a modern Fluid theme designed for fast scanning and efficient navigation.
- Select bundled backgrounds, local images, or an HTTPS background URL.
- Customize documented CSS variables or add validated custom CSS.
- Use browser-local favicons on Chrome and Edge, with an offline text monogram fallback on Firefox.
- Keep settings and uploaded images in the current browser profile only.

Privacy by design:

- No account, sign-in, cloud sync, advertising, analytics, or telemetry.
- No collection or upload of bookmarks, search terms, or usage activity.
- No requests to bookmark-site `/favicon.ico` paths and no third-party favicon service.
- Remote resources are blocked in custom CSS.

Permission use:

- `bookmarks`: read and display the browser bookmark tree.
- `storage`: save display and appearance settings locally.
- `favicon`: Chrome/Edge only, to read Chromium's browser-local website icons.

JTab supports desktop Chrome, Microsoft Edge, and Firefox. Chrome and Edge do not allow extensions to replace the new tab page in Incognito windows; this is a browser platform limitation.

## Single-purpose statement

JTab's sole purpose is to organize and display the current browser's local bookmarks as a customizable new tab page.

## Data-use disclosure

JTab does not collect, transmit, or sell user data. The Firefox package declares `data_collection_permissions.required = ["none"]`.
