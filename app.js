(() => {
  "use strict";

  const OWNER = "faysaltalukder";
  const REPO = "Central-resource-library-for-all-website-projects-images";
  const BRANCH = "main";
  const API = "https://api.github.com";
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const ALLOWED_TYPES = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml",
    "video/mp4", "video/webm"
  ]);

  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput");
  const dropzone = $("dropzone");
  const fileQueue = $("fileQueue");
  const fileCount = $("fileCount");
  const tokenInput = $("tokenInput");
  const testButton = $("testConnection");
  const uploadButton = $("uploadButton");
  const lockButton = $("lockSession");
  const connectionState = $("connectionState");
  const progressWrap = $("progressWrap");
  const progressText = $("progressText");
  const progressPercent = $("progressPercent");
  const progressBar = $("progressBar");
  const uploadedList = $("uploadedList");

  let selectedFiles = [];
  let githubToken = "";
  let connected = false;
  let busy = false;
  let uploadedThisSession = [];

  const headers = (token) => ({
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28"
  });

  function toast(message, isError = false) {
    const node = $("toast");
    node.textContent = message;
    node.className = "toast show" + (isError ? " error" : "");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { node.className = "toast"; }, 3600);
  }

  function setConnection(message, kind = "") {
    connectionState.className = "connection-state" + (kind ? " " + kind : "");
    connectionState.lastElementChild.textContent = message;
  }

  function setBusy(value) {
    busy = value;
    testButton.disabled = value;
    uploadButton.disabled = value || !connected || selectedFiles.length === 0;
    lockButton.disabled = value || !githubToken;
    fileInput.disabled = value;
    $("category").disabled = value;
    $("subfolder").disabled = value;
    $("clearQueue").disabled = value;
  }

  function prettySize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function isAllowed(file) {
    if (ALLOWED_TYPES.has(file.type)) return true;
    const ext = file.name.split(".").pop().toLowerCase();
    return ["jpg", "jpeg", "png", "webp", "gif", "svg", "mp4", "webm"].includes(ext);
  }

  function renderQueue() {
    fileCount.textContent = String(selectedFiles.length);
    uploadButton.disabled = busy || !connected || selectedFiles.length === 0;
    if (!selectedFiles.length) {
      fileQueue.className = "file-queue empty-state";
      fileQueue.textContent = "No files selected yet.";
      return;
    }
    fileQueue.className = "file-queue";
    fileQueue.replaceChildren();
    selectedFiles.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "queue-item";
      const preview = document.createElement(file.type.startsWith("image/") ? "img" : "div");
      preview.className = "queue-thumb";
      if (preview.tagName === "IMG") {
        preview.src = file.previewUrl;
        preview.alt = "";
      } else {
        preview.textContent = "▶";
        preview.style.display = "grid";
        preview.style.placeItems = "center";
      }
      const info = document.createElement("div");
      info.className = "queue-info";
      const name = document.createElement("b");
      name.textContent = file.name;
      const meta = document.createElement("small");
      meta.textContent = prettySize(file.size) + " · " + (file.type || "file");
      info.append(name, meta);
      const remove = document.createElement("button");
      remove.className = "remove-file";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.addEventListener("click", () => removeFile(index));
      item.append(preview, info, remove);
      fileQueue.append(item);
    });
  }

  function addFiles(list) {
    if (busy) return;
    const incoming = Array.from(list || []);
    let added = 0;
    incoming.forEach((file) => {
      if (!isAllowed(file)) {
        toast("Unsupported file type: " + file.name, true);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast(file.name + " is over the 20 MB limit.", true);
        return;
      }
      if (selectedFiles.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) return;
      if (selectedFiles.length >= 30) {
        toast("Select up to 30 files at a time.", true);
        return;
      }
      selectedFiles.push(Object.assign(file, { previewUrl: URL.createObjectURL(file) }));
      added += 1;
    });
    renderQueue();
    if (added) toast(added + " file(s) added to the upload queue.");
  }

  function removeFile(index) {
    const file = selectedFiles[index];
    if (file && file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    selectedFiles.splice(index, 1);
    renderQueue();
  }

  function clearQueue() {
    selectedFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    selectedFiles = [];
    fileInput.value = "";
    renderQueue();
  }

  async function apiRequest(url, options = {}, token = githubToken) {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers(token), ...(options.headers || {}) }
    });
    let data = null;
    const raw = await response.text();
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { message: raw }; }
    if (!response.ok) {
      const detail = data && data.message ? data.message : ("HTTP " + response.status);
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function verifyConnection() {
    const token = tokenInput.value.trim();
    if (!token) {
      setConnection("Enter a Fine-grained Personal Access Token first.", "error");
      toast("GitHub token is required.", true);
      return;
    }
    setBusy(true);
    setConnection("Checking GitHub account and repository…");
    try {
      const user = await apiRequest(API + "/user", {}, token);
      const repo = await apiRequest(API + "/repos/" + OWNER + "/" + REPO, {}, token);
      if (repo.full_name.toLowerCase() !== (OWNER + "/" + REPO).toLowerCase()) {
        throw new Error("The token opened a different repository.");
      }
      if (repo.permissions && repo.permissions.push === false) {
        throw new Error("This account does not have push access to the repository.");
      }
      githubToken = token;
      connected = true;
      setConnection("Connected as " + user.login + " · Repository visible. Upload permission will be confirmed on first upload.", "ok");
      tokenInput.value = "";
      tokenInput.placeholder = "Connected for this tab only";
      lockButton.disabled = false;
      uploadButton.disabled = selectedFiles.length === 0;
      toast("GitHub connection verified.");
      await loadLibrary();
    } catch (error) {
      connected = false;
      githubToken = "";
      setConnection(error.message || "Could not verify token.", "error");
      toast("Connection failed: " + error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function safeSegment(value) {
    return value.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80);
  }

  function encodedPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async function uniquePath(path) {
    const dot = path.lastIndexOf(".");
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
    const stem = ext ? path.slice(0, -ext.length) : path;
    for (let suffix = 1; suffix <= 99; suffix += 1) {
      const candidate = suffix === 1 ? path : stem + "-" + suffix + ext;
      const check = await fetch(API + "/repos/" + OWNER + "/" + REPO + "/contents/" + encodedPath(candidate) + "?ref=" + BRANCH, {
        headers: headers(githubToken)
      });
      if (check.status === 404) return candidate;
      if (!check.ok) {
        let message = "Could not check whether the file already exists.";
        try { const body = await check.json(); if (body.message) message = body.message; } catch (_) {}
        throw new Error(message);
      }
    }
    throw new Error("Too many files with the same name. Rename the file and try again.");
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read " + file.name));
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        if (comma < 0) return reject(new Error("Could not encode " + file.name));
        resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  function setProgress(done, total, label) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    progressWrap.hidden = false;
    progressText.textContent = label;
    progressPercent.textContent = percent + "%";
    progressBar.style.width = percent + "%";
  }

  async function uploadOne(file, index, total) {
    const category = $("category").value;
    const folder = safeSegment($("subfolder").value);
    const originalName = safeSegment(file.name.replace(/\s+/g, "-")) || ("asset-" + Date.now());
    const folderPath = ["assets", category, folder].filter(Boolean).join("/");
    const requestedPath = folderPath + "/" + originalName;
    const path = await uniquePath(requestedPath);
    setProgress(index, total, "Encoding " + file.name + "…");
    const encoded = await fileToBase64(file);
    const note = $("commitNote").value.trim();
    const message = (note || "Upload resource asset") + ": " + file.name;
    setProgress(index, total, "Uploading " + file.name + "…");
    const result = await apiRequest(API + "/repos/" + OWNER + "/" + REPO + "/contents/" + encodedPath(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: encoded,
        branch: BRANCH
      })
    });
    return {
      name: file.name,
      path,
      size: file.size,
      type: file.type,
      html_url: result.content && result.content.html_url ? result.content.html_url : ("https://github.com/" + OWNER + "/" + REPO + "/blob/" + BRANCH + "/" + encodedPath(path)),
      raw_url: "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/" + encodedPath(path)
    };
  }

  async function uploadFiles() {
    if (!connected || !githubToken) {
      toast("Connect to GitHub before uploading.", true);
      return;
    }
    if (!selectedFiles.length || busy) return;
    const batch = selectedFiles.slice();
    setBusy(true);
    progressBar.style.width = "0%";
    setProgress(0, batch.length, "Starting upload…");
    const success = [];
    try {
      for (let i = 0; i < batch.length; i += 1) {
        const result = await uploadOne(batch[i], i, batch.length);
        success.push(result);
        uploadedThisSession.unshift(result);
        setProgress(i + 1, batch.length, "Uploaded " + result.name);
      }
      clearQueue();
      renderUploaded(uploadedThisSession);
      toast(success.length + " file(s) uploaded successfully.");
      setConnection("Upload completed · " + success.length + " file(s) added to the Library.", "ok");
      await loadLibrary();
    } catch (error) {
      setConnection("Upload stopped: " + error.message, "error");
      toast("Upload stopped: " + error.message, true);
      if (success.length) {
        toast(success.length + " file(s) uploaded before the error. They remain in the Library.");
      }
    } finally {
      setBusy(false);
      uploadButton.disabled = !connected || selectedFiles.length === 0;
    }
  }

  function renderUploaded(items) {
    uploadedList.replaceChildren();
    if (!items.length) {
      uploadedList.className = "uploaded-list empty-state";
      uploadedList.textContent = "No resources found yet. Upload a file to get started.";
      return;
    }
    uploadedList.className = "uploaded-list";
    items.slice(0, 36).forEach((item) => {
      const card = document.createElement("article");
      card.className = "uploaded-card";
      let media;
      if (item.type && item.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(item.path)) {
        media = document.createElement("img");
        media.src = item.raw_url;
        media.loading = "lazy";
        media.alt = item.name;
      } else {
        media = document.createElement("div");
        media.className = "uploaded-placeholder";
        media.textContent = "▶";
      }
      const info = document.createElement("div");
      info.className = "uploaded-card-info";
      const name = document.createElement("b");
      name.textContent = item.name || item.path.split("/").pop();
      const meta = document.createElement("small");
      meta.textContent = prettySize(item.size || 0) + " · " + item.path;
      const link = document.createElement("a");
      link.href = item.html_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open file ↗";
      info.append(name, meta, link);
      card.append(media, info);
      uploadedList.append(card);
    });
  }

  async function loadLibrary() {
    try {
      const tree = await apiRequest(API + "/repos/" + OWNER + "/" + REPO + "/git/trees/" + BRANCH + "?recursive=1", {}, githubToken || undefined);
      const rows = (tree.tree || []).filter((entry) => entry.type === "blob" && entry.path.startsWith("assets/"));
      const items = rows.slice(-60).reverse().map((entry) => {
        const name = entry.path.split("/").pop();
        const ext = name.split(".").pop().toLowerCase();
        const image = ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext);
        return {
          name,
          path: entry.path,
          size: entry.size || 0,
          type: image ? "image/" + ext : "video/" + ext,
          html_url: "https://github.com/" + OWNER + "/" + REPO + "/blob/" + BRANCH + "/" + encodedPath(entry.path),
          raw_url: "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/" + encodedPath(entry.path)
        };
      });
      renderUploaded(items);
    } catch (error) {
      if (!uploadedThisSession.length) {
        uploadedList.className = "uploaded-list empty-state";
        uploadedList.textContent = "Could not load the collection: " + error.message;
      }
    }
  }

  function lockSession() {
    if (busy) return;
    githubToken = "";
    connected = false;
    tokenInput.value = "";
    tokenInput.placeholder = "github_pat_…";
    setConnection("Session locked · token cleared from this page.", "");
    uploadButton.disabled = true;
    lockButton.disabled = true;
    toast("Session locked. Token cleared.");
  }

  fileInput.addEventListener("change", (event) => {
    addFiles(event.target.files);
    fileInput.value = "";
  });
  $("clearQueue").addEventListener("click", clearQueue);
  testButton.addEventListener("click", verifyConnection);
  uploadButton.addEventListener("click", uploadFiles);
  lockButton.addEventListener("click", lockSession);
  $("refreshLibrary").addEventListener("click", loadLibrary);
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  }));
  dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  window.addEventListener("beforeunload", () => {
    selectedFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    githubToken = "";
  });

  renderQueue();
  loadLibrary();
})();