# Central Resource Library

A lightweight static website for organising and uploading reusable assets to this public GitHub repository.

## What this project does

- Provides a responsive upload page with drag-and-drop and multi-file selection.
- Previews selected images and shows a queue before upload.
- Uploads the **actual original file bytes** to this repository using the GitHub Contents API (Base64 is only the API transport encoding).
- Organises files under `pictures/<category>/<optional-folder>/`.
- Avoids overwriting an existing file: duplicate names get a numeric suffix.
- Shows the image/video asset collection from the repository.
- Keeps the fine-grained GitHub token in page memory only; it is not written to localStorage, sessionStorage, cookies, or repository files.

## Publish the website with GitHub Pages

The repository contains `.github/workflows/pages.yml`, which builds and deploys the static website on every push to `main`.

One-time setup:
1. Open this repository on GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open the **Actions** tab and check the **Deploy Resource Library to GitHub Pages** workflow.

After the first successful deployment, the project site URL will be:

`https://faysaltalukder.github.io/Central-resource-library-for-all-website-projects-images/`

The URL becomes active only after GitHub Pages is enabled and the workflow succeeds. If it is not live yet, check the workflow run in the Actions tab.

## Create a Fine-grained Personal Access Token

The upload interface needs a token from the repository owner because a public static website cannot safely contain a permanent server credential.

1. Open [GitHub Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).
2. Choose **Only select repositories** and select this Resource Library repository.
3. Set **Contents: Read and write**.
4. Keep **Metadata: Read-only**.
5. Choose a short expiration date. Do not enable unrelated permissions.
6. Create the token and paste it into the upload page's GitHub connection field.

The page verifies the account and repository. The first upload confirms whether the token can write Contents. When finished, use **Lock session & clear token** or close/refresh the page. Revoke the token in GitHub settings when it is no longer needed.

### Security notes

- The repository is **public**. Anything uploaded here can be viewed and downloaded by anyone. Do not upload private, confidential, licensed-with-restrictions, or personal files unless they are intended to be public.
- The token is used by browser JavaScript to call GitHub directly. This is why it must be fine-grained, limited to this one repository, and short-lived. Anyone able to change the website code could potentially change how the token is handled; use a dedicated least-privilege token and revoke it after testing if appropriate.
- The website does not save the token in browser storage, cookies, or the repository.
- Current UI limit: 20 MB per file, up to 30 files per batch. This conservative limit avoids oversized browser memory/API requests. GitHub's Contents API has a 100 MiB file limit; use Git LFS or object storage for larger media.
- Uploads are sequential to avoid simultaneous commits racing on the same branch.

## Repository layout

```text
.
├── index.html
├── styles.css
├── app.js
├── pictures/
│   ├── general/
│   ├── fashion/
│   ├── products/
│   └── website/
├── assets/
│   └── images/
│       └── library-mark.svg
└── .github/
    └── workflows/
        └── pages.yml
```

## Moving an asset to another website repository

Picture uploads are stored in the root-level `pictures/` folder by category (for example `pictures/fashion/` or `pictures/products/`). Other resource types such as logos, videos, UI components and documents are stored under `assets/<category>/`. The uploader stores the source file itself in this repository. To move an asset to another GitHub-hosted website, the transfer workflow must read the source file bytes and create the destination file with those bytes (not merely copy its URL). The destination repository also needs write access for the connected GitHub account/token. For external hosting providers, a separate destination credential or upload API is required.

## Supported formats

Images: JPG/JPEG, PNG, WEBP, GIF, SVG  
Videos: MP4, WEBM
