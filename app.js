(function () {
  "use strict";

  const FIREBASE = {
    projectId: "kitas-docket",
    apiKey: "AIzaSyDB8_FkiyOmAptAiO3J9ttQ5ui310wtA0c",
  };
  const seed = window.KITAS_DOCKET_SEED;
  const state = {
    courses: seed.courses,
    items: seed.items,
    materials: seed.materials,
    standingFlags: seed.standingFlags,
    selectedCourseId: "civil-procedure",
    activeCourseFilter: "all",
    flaggedOnly: false,
    rangeDays: 7,
    calendarMonth: startOfMonth(new Date(2026, 7, 1)),
    selectedDate: localDateKey(new Date()),
    search: "",
    connected: false,
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

  async function hydrate() {
    const requests = await Promise.allSettled([
      readDocument("courses"),
      readDocument("items"),
      readDocument("materialsV2"),
      readDocument("standingFlags"),
    ]);
    const [courses, items, materials, flags] = requests.map((request) => request.status === "fulfilled" ? request.value : null);
    if (Array.isArray(courses) && courses.length) state.courses = courses;
    if (Array.isArray(items) && items.length) state.items = items;
    if (Array.isArray(materials) && materials.length) state.materials = materials;
    if (Array.isArray(flags) && flags.length) state.standingFlags = flags;
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
    const courses = [...state.courses].sort((a, b) => a.time.localeCompare(b.time));
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
    $("#confirmation-preview").innerHTML = flags.slice(0, 3).map((flag) => {
      const course = courseById()[flag.courseId];
      return `<div class="flag-preview"><strong>${escapeHTML(flag.title)}</strong><p>${escapeHTML(course?.name || "School calendar")} · ${escapeHTML(flag.details)}</p></div>`;
    }).join("");
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
        </div>
      </div>
      <div class="course-timeline">
        <h4>Semester plan</h4>
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
    $("#materials-grid").innerHTML = state.materials.length ? state.materials.map((material) => {
      const course = courseById()[material.courseId];
      return `<article class="material-card"><span class="material-type">${escapeHTML(material.type || "Course material")}</span><h4>${escapeHTML(material.title)}</h4><p>${escapeHTML(material.content || "Source material saved to the docket.")}</p><footer>${escapeHTML(course?.name || "General")} · Added ${escapeHTML(material.addedDate || "")}</footer></article>`;
    }).join("") : $("#empty-state-template").innerHTML;
  }

  function renderAll() {
    renderHeader();
    renderSchedule();
    renderConfirmations();
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
      $("#item-form [name=date]").value = localDateKey(new Date());
      $("#form-status").textContent = "";
      $("#item-dialog").showModal();
    });
    $("#item-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveNewItem(event.currentTarget);
    });
  }

  renderAll();
  bindEvents();
  hydrate();
})();
