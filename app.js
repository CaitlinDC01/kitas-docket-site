(function () {
  "use strict";

  const FIREBASE = {
    projectId: "kitas-docket",
    apiKey: "AIzaSyDB8_FkiyOmAptAiO3J9ttQ5ui310wtA0c",
  };
  const FILE_CHUNK_BYTES = 450000;
  const seed = window.KITAS_DOCKET_SEED;
  const state = {
    courses: seed.courses,
    items: seed.items,
    materials: seed.materials,
    standingFlags: seed.standingFlags,
    quickLinks: seed.quickLinks || {},
    selectedCourseId: "civil-procedure",
    activeCourseFilter: "all",
    flaggedOnly: false,
    rangeDays: 7,
    calendarMonth: startOfMonth(new Date(2026, 7, 1)),
    selectedDate: localDateKey(new Date()),
    search: "",
    connected: false,
    readingGoals: { dailyTarget: 30, weeklyTarget: 150, log: {} },
  };

  const courseById = () => Object.fromEntries(state.courses.map((course) => [course.id, course]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHTML(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function parseDate(date) {
    return new Date(`${date}T12:00:00`);
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(date, count) {
    const result = new Date(date);
    result.setDate(result.getDate() + count);
    return result;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 12);
  }

  function timeToMinutes(value) {
    const match = String(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return Number.MAX_SAFE_INTEGER;
    let hour = Number(match[1]) % 12;
    const minute = Number(match[2]);
    if (match[3].toUpperCase() === "PM") hour += 12;
    return hour * 60 + minute;
  }

  function formatDate(date, options = {}) {
    return parseDate(typeof date === "string" ? date : localDateKey(date)).toLocaleDateString("en-US", options);
  }

  function dateRangeLabel(item) {
    const start = formatDate(item.date, { month: "short", day: "numeric" });
    if (!item.endDate) return start;
    const end = formatDate(item.endDate, { month: "short", day: "numeric" });
    return `${start}-${end}`;
  }

  function firestoreUrl(documentName) {
    return `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/kitasDocket/${documentName}?key=${FIREBASE.apiKey}`;
  }

  function firestorePathUrl(documentPath) {
    return `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/${documentPath}?key=${FIREBASE.apiKey}`;
  }

  async function readDocument(documentName) {
    const response = await fetch(firestoreUrl(documentName));
    if (!response.ok) throw new Error(`Could not load ${documentName}`);
    const document = await response.json();
    const raw = document?.fields?.value?.stringValue;
    return raw ? JSON.parse(raw) : null;
  }

  async function writeDocument(documentName, value) {
    const response = await fetch(`${firestoreUrl(documentName)}&updateMask.fieldPaths=value`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: { value: { stringValue: JSON.stringify(value) } } }),
    });
    if (!response.ok) throw new Error(`Could not save ${documentName}`);
    return response.json();
  }

  async function writeFileChunk(fileId, index, value) {
    const path = `kitasDocketFiles/${fileId}/chunks/${String(index).padStart(4, "0")}`;
    const response = await fetch(`${firestorePathUrl(path)}&updateMask.fieldPaths=value`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: { value: { stringValue: value } } }),
    });
    if (!response.ok) throw new Error(`Could not save file part ${index + 1}`);
  }

  async function readFileChunk(fileId, index) {
    const path = `kitasDocketFiles/${fileId}/chunks/${String(index).padStart(4, "0")}`;
    const response = await fetch(firestorePathUrl(path));
    if (!response.ok) throw new Error(`Could not load file part ${index + 1}`);
    const document = await response.json();
    return document?.fields?.value?.stringValue || "";
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function hydrate() {
    const requests = await Promise.allSettled([
      readDocument("courses"),
      readDocument("items"),
      readDocument("materialsV2"),
      readDocument("standingFlags"),
      readDocument("readingGoals"),
    ]);
    const [courses, items, materials, flags, readingGoals] = requests.map((request) => request.status === "fulfilled" ? request.value : null);
    if (Array.isArray(courses) && courses.length) state.courses = courses;
    if (Array.isArray(items) && items.length) state.items = items;
    if (Array.isArray(materials) && materials.length) state.materials = materials;
    if (Array.isArray(flags) && flags.length) state.standingFlags = flags;
    if (readingGoals && typeof readingGoals === "object") {
      state.readingGoals = { ...state.readingGoals, ...readingGoals, log: readingGoals.log || {} };
    }
    state.connected = requests.some((request) => request.status === "fulfilled");
    if (!state.connected) console.warn("Using verified built-in docket data while live storage is unavailable.");
    renderAll();
  }

  function setView(view) {
    $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
    $$("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
    const titles = { today: "Today's docket", courses: "Course workspace", calendar: "Calendar", materials: "Materials" };
    $("#view-title").textContent = titles[view] || "Kita's Docket";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function itemTouchesDate(item, dateKey) {
    return item.date <= dateKey && (item.endDate || item.date) >= dateKey;
  }

  function filteredItems() {
    const query = state.search.trim().toLowerCase();
    return state.items.filter((item) => {
      const matchesCourse = state.activeCourseFilter === "all" || item.courseId === state.activeCourseFilter;
      const matchesFlag = !state.flaggedOnly || item.flagged;
      const matchesSearch = !query || `${item.title} ${item.details} ${item.type}`.toLowerCase().includes(query);
      return matchesCourse && matchesFlag && matchesSearch;
    });
  }

  function renderHeader() {
    const today = new Date();
    $("#today-label").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    $("#hero-date").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const todaysClasses = state.courses.filter((course) => course.days.includes(today.getDay()));
    const todayItems = state.items.filter((item) => itemTouchesDate(item, localDateKey(today)));
    const nextClassDay = state.courses.length ? "Classes begin Monday, August 17." : "";
    $("#hero-heading").textContent = todayItems.length ? `${todayItems.length} item${todayItems.length === 1 ? "" : "s"} on today's docket.` : "Your semester, without the scramble.";
    $("#hero-summary").textContent = todaysClasses.length
      ? `${todaysClasses.length} classes today, with every reading and deadline kept in its own course lane.`
      : `${nextClassDay} Use this calm overview for what is next, then open a course when you need the full detail.`;

    const start = parseDate(seed.term.startDate);
    const end = parseDate(seed.term.endDate);
    const total = Math.max(1, end - start);
    const elapsed = Math.max(0, Math.min(total, today - start));
    const percent = Math.round((elapsed / total) * 100);
    $("#term-progress-bar").style.width = `${percent}%`;
    const remaining = Math.max(0, Math.ceil((end - today) / 86400000));
    $("#term-progress-copy").textContent = today < start ? `${Math.ceil((start - today) / 86400000)} days until classes begin.` : `${remaining} days until the last day of classes.`;
  }

  function renderSchedule() {
    const courses = [...state.courses].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    $("#schedule-strip").innerHTML = courses.map((course) => `
      <article class="class-block" style="--course-color:${escapeHTML(course.color)}">
        <time>${escapeHTML(course.time)}${course.endTime ? `-${escapeHTML(course.endTime)}` : ""}</time>
        <h4>${escapeHTML(course.name)}</h4>
        <p>${escapeHTML(course.room)}</p>
      </article>
    `).join("");
  }

  function renderConfirmations() {
    const dateFlags = state.items.filter((item) => item.flagged).map((item) => ({
      id: item.id,
      courseId: item.courseId,
      title: item.title,
      details: `${dateRangeLabel(item)} · ${item.details}`,
    }));
    const flags = [...state.standingFlags, ...dateFlags];
    $("#confirmation-count").textContent = flags.length;
    $("#confirmation-preview").innerHTML = flags.slice(0, 2).map((flag) => {
      const course = courseById()[flag.courseId];
      return `<div class="flag-preview"><strong>${escapeHTML(flag.title)}</strong><p>${escapeHTML(course?.name || "School calendar")} · ${escapeHTML(flag.details)}</p></div>`;
    }).join("");
  }

  function startOfWeek(date) {
    const result = new Date(date);
    const offset = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - offset);
    return result;
  }

  function renderPageGoal(target, completed, label) {
    const safeTarget = Math.max(1, Number(target) || 1);
    const safeCompleted = Math.max(0, Number(completed) || 0);
    const percent = Math.min(100, Math.round((safeCompleted / safeTarget) * 100));
    return `<div class="goal-copy"><strong>${safeCompleted} <span>/ ${safeTarget} pages</span></strong><small>${escapeHTML(label)}</small></div><div class="goal-track" aria-label="${escapeHTML(label)}: ${percent}% complete"><span style="width:${percent}%"></span></div><b>${percent}%</b>`;
  }

  function renderReadingProgress() {
    const today = new Date();
    const todayKey = localDateKey(today);
    const weekStart = startOfWeek(today);
    const weekKeys = Array.from({ length: 7 }, (_, index) => localDateKey(addDays(weekStart, index)));
    const todayPages = Number(state.readingGoals.log[todayKey] || 0);
    const weekPages = weekKeys.reduce((total, key) => total + Number(state.readingGoals.log[key] || 0), 0);
    $("#daily-page-goal").innerHTML = renderPageGoal(state.readingGoals.dailyTarget, todayPages, "Today");
    $("#weekly-page-goal").innerHTML = renderPageGoal(state.readingGoals.weeklyTarget, weekPages, "This week");
    $("#pages-read-today").value = todayPages;
  }

  function groupByDate(items) {
    return items.reduce((groups, item) => {
      (groups[item.date] ||= []).push(item);
      return groups;
    }, {});
  }

  function renderUpcoming() {
    const today = localDateKey(new Date());
    const through = localDateKey(addDays(new Date(), state.rangeDays));
    let items = filteredItems().filter((item) => item.date >= today && item.date <= through);
    if (state.search) items = filteredItems().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
    items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const groups = groupByDate(items);
    if (!items.length) {
      $("#upcoming-list").innerHTML = $("#empty-state-template").innerHTML;
      return;
    }
    $("#upcoming-list").innerHTML = Object.entries(groups).map(([date, dateItems]) => `
      <div class="agenda-date">
        <div class="date-chip">${formatDate(date, { weekday: "short" })}<strong>${formatDate(date, { day: "numeric" })}</strong>${formatDate(date, { month: "short" })}</div>
        <div class="agenda-items">
          ${dateItems.map(renderAgendaItem).join("")}
        </div>
      </div>
    `).join("");
  }

  function renderAgendaItem(item) {
    const course = courseById()[item.courseId];
    return `
      <article class="agenda-item" style="--course-color:${escapeHTML(course?.color || "#c49a53")}">
        <span class="course-dot" aria-hidden="true"></span>
        <div><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(course?.name || "School calendar")}${item.endDate ? ` · through ${formatDate(item.endDate, { month: "short", day: "numeric" })}` : ""}${item.flagged ? " · Needs confirmation" : ""}</p></div>
        <span class="type-badge">${escapeHTML(item.type)}</span>
      </article>
    `;
  }

  function renderCourseRail() {
    const today = localDateKey(new Date());
    $("#course-rail").innerHTML = `<div class="course-rail-list">${state.courses.map((course) => {
      const upcoming = state.items.filter((item) => item.courseId === course.id && item.date >= today).length;
      return `<button class="course-rail-item" data-open-course="${escapeHTML(course.id)}" style="--course-color:${escapeHTML(course.color)}"><span class="course-swatch"></span><span><strong>${escapeHTML(course.name)}</strong><small>${escapeHTML(course.time)} · M/W/F</small></span><span>${upcoming}</span></button>`;
    }).join("")}</div>`;
  }

  function populateCourseControls() {
    const options = state.courses.map((course) => `<option value="${escapeHTML(course.id)}">${escapeHTML(course.name)}</option>`).join("");
    $("#course-select").innerHTML = options;
    $("#course-select").value = state.selectedCourseId;
    $("#item-course").innerHTML = `<option value="">School-wide</option>${options}`;
    $("#upload-course").innerHTML = options;
    $("#course-filters").innerHTML = `<button class="filter-chip is-active" data-course-filter="all">All courses</button>${state.courses.map((course) => `<button class="filter-chip" data-course-filter="${escapeHTML(course.id)}">${escapeHTML(course.name)}</button>`).join("")}`;
  }

  function renderCourseGrid() {
    const today = localDateKey(new Date());
    $("#course-grid").innerHTML = state.courses.map((course) => {
      const upcoming = state.items.filter((item) => item.courseId === course.id && item.date >= today).length;
      return `<button class="course-card ${course.id === state.selectedCourseId ? "is-active" : ""}" data-open-course="${escapeHTML(course.id)}" style="--course-color:${escapeHTML(course.color)}"><span class="course-code">${escapeHTML(course.code)}${course.section ? ` · Sec. ${escapeHTML(course.section)}` : ""}</span><h4>${escapeHTML(course.name)}</h4><p>${escapeHTML(course.time)}${course.endTime ? `-${escapeHTML(course.endTime)}` : ""}<br>Monday · Wednesday · Friday</p><span class="item-count">${upcoming} upcoming</span></button>`;
    }).join("");
  }

  function renderCourseDetail() {
    const course = courseById()[state.selectedCourseId] || state.courses[0];
    const items = state.items.filter((item) => item.courseId === course.id).sort((a, b) => a.date.localeCompare(b.date));
    const materials = state.materials.filter((material) => material.courseId === course.id);
    $("#course-detail").style.setProperty("--course-color", course.color);
    $("#course-detail").innerHTML = `
      <div class="course-detail-header">
        <div>
          <p class="section-kicker">${escapeHTML(course.code)}${course.section ? ` · Section ${escapeHTML(course.section)}` : ""}</p>
          <h3>${escapeHTML(course.name)}</h3>
          <p>${escapeHTML(course.description)}</p>
          <p><strong>Standing note:</strong> ${escapeHTML(course.standingNote)}</p>
        </div>
        <div class="course-meta">
          <div class="meta-card"><small>Professor</small><strong>${escapeHTML(course.professor)}</strong></div>
          <div class="meta-card"><small>Room</small><strong>${escapeHTML(course.room)}</strong></div>
          <div class="meta-card"><small>Meeting</small><strong>M/W/F</strong></div>
          <div class="meta-card"><small>Time</small><strong>${escapeHTML(course.time)}${course.endTime ? `-${escapeHTML(course.endTime)}` : ""}</strong></div>
          ${course.email ? `<div class="meta-card meta-card-wide"><small>Email</small><a href="mailto:${escapeHTML(course.email)}">${escapeHTML(course.email)}</a></div>` : ""}
          ${course.phone ? `<div class="meta-card"><small>Phone</small><a href="tel:${escapeHTML(course.phone.replaceAll(/[^\d+]/g, ""))}">${escapeHTML(course.phone)}</a></div>` : ""}
          ${course.officeLocation ? `<div class="meta-card"><small>Office</small><strong>${escapeHTML(course.officeLocation)}</strong></div>` : ""}
          ${course.officeHours ? `<div class="meta-card meta-card-wide"><small>Office hours</small><strong>${escapeHTML(course.officeHours)}</strong></div>` : ""}
        </div>
      </div>
      ${course.alert ? `<aside class="course-alert" role="alert"><span aria-hidden="true">!</span><div><strong>Course integrity warning</strong><p>${escapeHTML(course.alert)}</p></div></aside>` : ""}
      ${(course.requiredMaterials?.length || course.grading?.length || course.rules?.length) ? `
        <div class="course-information-grid">
          ${course.requiredMaterials?.length ? `<section class="course-info-card"><p class="section-kicker">Required materials</p><ul>${course.requiredMaterials.map((entry) => `<li>${escapeHTML(entry)}</li>`).join("")}</ul></section>` : ""}
          ${course.grading?.length ? `<section class="course-info-card"><p class="section-kicker">Grading</p><ul>${course.grading.map((entry) => `<li>${escapeHTML(entry)}</li>`).join("")}</ul></section>` : ""}
          ${course.rules?.length ? `<section class="course-info-card"><p class="section-kicker">Rules & reminders</p><ul>${course.rules.map((entry) => `<li>${escapeHTML(entry)}</li>`).join("")}</ul></section>` : ""}
        </div>
      ` : ""}
      <section class="course-resources">
        <div><p class="section-kicker">Materials & resources</p><h4>${materials.length} saved document${materials.length === 1 ? "" : "s"}</h4><p>Syllabi, assignment sheets, outlines, and other course files stay together here.</p></div>
        <div class="course-resource-actions">
          ${course.syllabusUrl ? `<a class="syllabus-button" href="${escapeHTML(course.syllabusUrl)}" target="_blank" rel="noopener">Open syllabus ↗</a>` : `<button class="course-resource-link syllabus-pending" data-open-upload data-course-id="${escapeHTML(course.id)}">Upload original syllabus</button>`}
          ${materials.slice(0, 2).map((material) => material.url ? `<a href="${escapeHTML(material.url)}" target="_blank" rel="noopener">${escapeHTML(material.title)}</a>` : material.fileId ? `<button class="course-resource-link" data-open-material="${escapeHTML(material.id)}">${escapeHTML(material.title)}</button>` : `<span>${escapeHTML(material.title)}</span>`).join("")}
          <button class="button button-primary" data-open-upload data-course-id="${escapeHTML(course.id)}">+ Add document</button>
        </div>
      </section>
      <div class="course-timeline">
        <div class="timeline-heading"><h4>Semester plan</h4><button class="button button-secondary" data-add-course-item="${escapeHTML(course.id)}">+ Add assignment or reading</button></div>
        ${items.length ? items.map((item) => `
          <article class="timeline-row">
            <time>${escapeHTML(dateRangeLabel(item))}</time>
            <span class="timeline-mark"></span>
            <div><h5>${escapeHTML(item.title)}</h5><p>${escapeHTML(item.details)}</p></div>
            ${item.flagged ? '<span class="flag-pill">Confirm</span>' : `<span class="type-badge">${escapeHTML(item.type)}</span>`}
          </article>
        `).join("") : $("#empty-state-template").innerHTML}
      </div>
    `;
  }

  function renderCalendar() {
    const month = state.calendarMonth;
    $("#month-title").textContent = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const firstGridDate = addDays(month, -month.getDay());
    const items = filteredItems();
    const courses = courseById();
    const days = Array.from({ length: 42 }, (_, index) => addDays(firstGridDate, index));
    $("#calendar-grid").innerHTML = days.map((date) => {
      const key = localDateKey(date);
      const dayItems = items.filter((item) => itemTouchesDate(item, key));
      const classes = [...new Set(dayItems.map((item) => item.courseId))].slice(0, 5);
      const isOutside = date.getMonth() !== month.getMonth();
      return `<button class="calendar-day ${isOutside ? "is-outside" : ""} ${key === state.selectedDate ? "is-selected" : ""} ${key === localDateKey(new Date()) ? "is-today" : ""}" data-calendar-date="${key}" aria-label="${formatDate(key, { month: "long", day: "numeric", year: "numeric" })}, ${dayItems.length} items"><span class="day-number">${date.getDate()}</span><span class="calendar-dots">${classes.map((id) => `<span class="calendar-dot" style="--course-color:${escapeHTML(courses[id]?.color || "#c49a53")}"></span>`).join("")}</span>${dayItems.length > 5 ? `<small class="calendar-more">+${dayItems.length - 5} more</small>` : ""}</button>`;
    }).join("");
    renderSelectedDay();
  }

  function renderSelectedDay() {
    const items = filteredItems().filter((item) => itemTouchesDate(item, state.selectedDate));
    $("#selected-day-label").textContent = formatDate(state.selectedDate, { weekday: "long" });
    $("#selected-day-title").textContent = formatDate(state.selectedDate, { month: "long", day: "numeric" });
    $("#selected-day-items").innerHTML = items.length ? items.map((item) => {
      const course = courseById()[item.courseId];
      return `<article class="day-item"><span class="type-badge">${escapeHTML(course?.name || "School-wide")} · ${escapeHTML(item.type)}</span><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.details)}</p>${item.flagged ? '<span class="flag-pill">Needs confirmation</span>' : ""}</article>`;
    }).join("") : $("#empty-state-template").innerHTML;
  }

  function renderMaterials() {
    const syllabusLibrary = `<section class="syllabus-library">
      <div class="syllabus-library-heading"><div><p class="section-kicker">Always within reach</p><h3>Fall 2026 syllabus library</h3><p>Open the original course PDFs from any device.</p></div>
      <div class="library-quick-actions"><a class="button button-primary" href="${escapeHTML(state.quickLinks.firstTwoWeeksChecklist || "#")}" target="_blank" rel="noopener">First two weeks checklist ↗</a><button class="button button-secondary" type="button" disabled title="Add Rekita's OneNote link when it is live">OneNote notes · coming soon</button></div></div>
      <div class="syllabus-link-grid">${state.courses.map((course) => course.syllabusUrl
        ? `<a class="syllabus-link-card" href="${escapeHTML(course.syllabusUrl)}" target="_blank" rel="noopener" style="--course-color:${escapeHTML(course.color)}"><span class="course-swatch"></span><strong>${escapeHTML(course.name)}</strong><small>Open syllabus PDF ↗</small></a>`
        : `<button class="syllabus-link-card is-pending" data-open-upload data-course-id="${escapeHTML(course.id)}" style="--course-color:${escapeHTML(course.color)}"><span class="course-swatch"></span><strong>${escapeHTML(course.name)}</strong><small>${escapeHTML(course.syllabusStatus || "Upload syllabus PDF")}</small></button>`).join("")}</div>
    </section>`;
    $("#materials-grid").innerHTML = syllabusLibrary + state.courses.map((course) => {
      const materials = state.materials.filter((material) => material.courseId === course.id);
      return `<section class="course-material-group" style="--course-color:${escapeHTML(course.color)}">
        <header><span class="course-swatch"></span><div><p class="section-kicker">${escapeHTML(course.code)}</p><h4>${escapeHTML(course.name)}</h4></div><span>${materials.length} file${materials.length === 1 ? "" : "s"}</span></header>
        <div class="course-material-list">
          ${materials.map((material) => `<article class="material-card"><span class="material-type">${escapeHTML(material.type || "Course material")}</span><h5>${escapeHTML(material.title)}</h5><p>${escapeHTML(material.content || "Source material saved to the docket.")}</p><footer>Added ${escapeHTML(material.addedDate || "")}${material.size ? ` · ${escapeHTML(formatFileSize(material.size))}` : ""}</footer>${material.url ? `<a class="material-link" href="${escapeHTML(material.url)}" target="_blank" rel="noopener">Open document ↗</a>` : material.fileId ? `<button class="material-link" data-open-material="${escapeHTML(material.id)}">Open document ↗</button>` : ""}</article>`).join("")}
          <button class="upload-card" data-open-upload data-course-id="${escapeHTML(course.id)}"><span>+</span><strong>Add syllabus or resource</strong><small>PDF, Word, text, or image</small></button>
        </div>
      </section>`;
    }).join("");
  }

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderAll() {
    renderHeader();
    renderSchedule();
    renderConfirmations();
    renderReadingProgress();
    renderUpcoming();
    renderCourseRail();
    populateCourseControls();
    renderCourseGrid();
    renderCourseDetail();
    renderCalendar();
    renderMaterials();
  }

  function openCourse(courseId) {
    state.selectedCourseId = courseId;
    $("#course-select").value = courseId;
    renderCourseGrid();
    renderCourseDetail();
    setView("courses");
    setTimeout(() => $("#course-detail").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function openItemDialog(courseId = "", type = "assignment") {
    $("#item-form [name=date]").value = localDateKey(new Date());
    $("#item-course").value = courseId;
    $("#item-form [name=type]").value = type;
    $("#form-status").textContent = "";
    $("#item-dialog").showModal();
  }

  async function saveNewItem(form) {
    const data = new FormData(form);
    const item = {
      id: `manual-${Date.now()}`,
      courseId: data.get("courseId") || "",
      type: data.get("type"),
      title: String(data.get("title") || "").trim(),
      date: data.get("date"),
      endDate: data.get("endDate") || "",
      details: String(data.get("details") || "").trim(),
      flagged: data.get("flagged") === "on",
      done: false,
    };
    if (!item.title || !item.date) return;
    const nextItems = [...state.items, item];
    $("#form-status").textContent = "Saving...";
    try {
      await writeDocument("items", nextItems);
      state.items = nextItems;
      state.connected = true;
      form.reset();
      $("#item-dialog").close();
      renderAll();
    } catch (error) {
      $("#form-status").textContent = "This could not be saved. Please try again.";
      console.error(error);
    }
  }

  async function saveReadingGoals(form) {
    const data = new FormData(form);
    const nextGoals = {
      ...state.readingGoals,
      dailyTarget: Math.max(1, Number(data.get("dailyTarget")) || 1),
      weeklyTarget: Math.max(1, Number(data.get("weeklyTarget")) || 1),
    };
    $("#goal-status").textContent = "Saving...";
    try {
      await writeDocument("readingGoals", nextGoals);
      state.readingGoals = nextGoals;
      $("#goal-dialog").close();
      renderReadingProgress();
    } catch (error) {
      $("#goal-status").textContent = "These goals could not be saved. Please try again.";
      console.error(error);
    }
  }

  async function savePagesRead(form) {
    const data = new FormData(form);
    const todayKey = localDateKey(new Date());
    const nextGoals = {
      ...state.readingGoals,
      log: { ...state.readingGoals.log, [todayKey]: Math.max(0, Number(data.get("pagesRead")) || 0) },
    };
    const button = form.querySelector("button[type=submit]");
    button.textContent = "Saving...";
    try {
      await writeDocument("readingGoals", nextGoals);
      state.readingGoals = nextGoals;
      renderReadingProgress();
      button.textContent = "Saved";
      setTimeout(() => { button.textContent = "Save"; }, 1200);
    } catch (error) {
      button.textContent = "Try again";
      console.error(error);
    }
  }

  async function uploadMaterial(form) {
    const data = new FormData(form);
    const file = data.get("document");
    if (!(file instanceof File) || !file.size) return;
    if (file.size > 15 * 1024 * 1024) {
      $("#upload-status").textContent = "Please choose a file smaller than 15 MB.";
      return;
    }
    const courseId = String(data.get("courseId"));
    const uniqueId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const fileId = `file-${Date.now()}-${uniqueId}`;
    $("#upload-status").textContent = "Uploading document...";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += FILE_CHUNK_BYTES) {
        chunks.push(bytesToBase64(bytes.subarray(offset, offset + FILE_CHUNK_BYTES)));
      }
      for (let index = 0; index < chunks.length; index += 3) {
        $("#upload-status").textContent = `Uploading document... ${Math.min(index + 3, chunks.length)} of ${chunks.length} parts`;
        await Promise.all(chunks.slice(index, index + 3).map((chunk, batchIndex) => writeFileChunk(fileId, index + batchIndex, chunk)));
      }
      const material = {
        id: `upload-${Date.now()}`,
        courseId,
        title: file.name,
        type: file.type || "Course document",
        addedDate: localDateKey(new Date()),
        content: String(data.get("notes") || "Uploaded course resource.").trim() || "Uploaded course resource.",
        size: file.size,
        fileId,
        chunkCount: chunks.length,
        mimeType: file.type || "application/octet-stream",
      };
      const nextMaterials = [...state.materials, material];
      await writeDocument("materialsV2", nextMaterials);
      state.materials = nextMaterials;
      form.reset();
      $("#upload-dialog").close();
      renderMaterials();
      renderCourseDetail();
    } catch (error) {
      $("#upload-status").textContent = "This document could not be uploaded. Please try again.";
      console.error(error);
    }
  }

  async function openMaterial(materialId, trigger) {
    const material = state.materials.find((entry) => entry.id === materialId);
    if (!material?.fileId || !material.chunkCount) return;
    const originalText = trigger.textContent;
    const previewWindow = window.open("", "_blank");
    if (previewWindow) previewWindow.document.body.innerHTML = "<p style='font:16px system-ui;padding:24px'>Loading document...</p>";
    trigger.textContent = "Opening...";
    trigger.disabled = true;
    try {
      const encodedChunks = await Promise.all(Array.from({ length: material.chunkCount }, (_, index) => readFileChunk(material.fileId, index)));
      const blob = new Blob(encodedChunks.map(base64ToBytes), { type: material.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      if (previewWindow) previewWindow.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = material.title;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      if (previewWindow) previewWindow.close();
      window.alert("This document could not be opened. Please try again.");
      console.error(error);
    } finally {
      trigger.textContent = originalText;
      trigger.disabled = false;
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) setView(viewButton.dataset.view);
      const jumpButton = event.target.closest("[data-jump]");
      if (jumpButton) {
        if (jumpButton.dataset.filter === "flagged") {
          state.flaggedOnly = true;
          $("#flagged-only").checked = true;
          renderCalendar();
        }
        setView(jumpButton.dataset.jump);
      }
      const courseButton = event.target.closest("[data-open-course]");
      if (courseButton) openCourse(courseButton.dataset.openCourse);
      const addCourseItemButton = event.target.closest("[data-add-course-item]");
      if (addCourseItemButton) openItemDialog(addCourseItemButton.dataset.addCourseItem, "assignment");
      const rangeButton = event.target.closest("[data-range]");
      if (rangeButton) {
        state.rangeDays = Number(rangeButton.dataset.range);
        $$('[data-range]').forEach((button) => button.classList.toggle("is-active", button === rangeButton));
        renderUpcoming();
      }
      const filterButton = event.target.closest("[data-course-filter]");
      if (filterButton) {
        state.activeCourseFilter = filterButton.dataset.courseFilter;
        $$('[data-course-filter]').forEach((button) => button.classList.toggle("is-active", button === filterButton));
        renderCalendar();
      }
      const calendarDay = event.target.closest("[data-calendar-date]");
      if (calendarDay) {
        state.selectedDate = calendarDay.dataset.calendarDate;
        renderCalendar();
      }
      if (event.target.closest("[data-close-dialog]")) $("#item-dialog").close();
      const uploadButton = event.target.closest("[data-open-upload]");
      if (uploadButton) {
        $("#upload-course").value = uploadButton.dataset.courseId || state.selectedCourseId || state.courses[0].id;
        $("#upload-status").textContent = "";
        $("#upload-dialog").showModal();
      }
      const materialButton = event.target.closest("[data-open-material]");
      if (materialButton) openMaterial(materialButton.dataset.openMaterial, materialButton);
      if (event.target.closest("[data-close-upload]")) $("#upload-dialog").close();
      if (event.target.closest("[data-close-goals]")) $("#goal-dialog").close();
    });

    $("#course-select").addEventListener("change", (event) => openCourse(event.target.value));
    $("#global-search").addEventListener("input", (event) => {
      state.search = event.target.value;
      setView("today");
      renderUpcoming();
    });
    $("#flagged-only").addEventListener("change", (event) => {
      state.flaggedOnly = event.target.checked;
      renderCalendar();
    });
    $("#previous-month").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1, 12);
      renderCalendar();
    });
    $("#next-month").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1, 12);
      renderCalendar();
    });
    $("#open-add-item").addEventListener("click", () => {
      openItemDialog(state.selectedCourseId, "assignment");
    });
    $("#item-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveNewItem(event.currentTarget);
    });
    $("#pages-read-form").addEventListener("submit", (event) => {
      event.preventDefault();
      savePagesRead(event.currentTarget);
    });
    $("#open-goal-settings").addEventListener("click", () => {
      $("#goal-form [name=dailyTarget]").value = state.readingGoals.dailyTarget;
      $("#goal-form [name=weeklyTarget]").value = state.readingGoals.weeklyTarget;
      $("#goal-status").textContent = "";
      $("#goal-dialog").showModal();
    });
    $("#goal-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveReadingGoals(event.currentTarget);
    });
    $("#upload-form").addEventListener("submit", (event) => {
      event.preventDefault();
      uploadMaterial(event.currentTarget);
    });
  }

  renderAll();
  bindEvents();
  hydrate();
})();
