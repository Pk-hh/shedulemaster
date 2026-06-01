/**
 * PlanFlow — Schedule Planner script.js
 * Implements LocalStorage task management, a responsive yearly calendar,
 * full-text search, data backup (JSON export/import), custom alerts/modals,
 * dark/light themes, and optional Web Push Notification reminders.
 */

// Service Worker Registration for offline durability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('PlanFlow Service Worker registered successfully:', reg.scope);
    }).catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // STATE DEFINITIONS
  // ==========================================
  let currentDate = new Date(); // Date currently selected/displayed in task list
  let calendarDate = new Date(); // Date context for the monthly calendar grid view
  let schedules = {}; // Key: "YYYY-MM-DD", Value: Array of Tasks
  let confirmCallback = null; // Callback container for custom confirm modals
  let isLocalStorageAvailable = true;

  // In-memory fallback if LocalStorage fails/is disabled
  let inMemorySchedules = {};

  // Check if LocalStorage is available and writeable
  function checkStorageAvailability() {
    try {
      const testKey = '__planflow_storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      isLocalStorageAvailable = true;
    } catch (e) {
      isLocalStorageAvailable = false;
      console.warn("LocalStorage unavailable. Falling back to in-memory store.");
    }
  }
  checkStorageAvailability();

  // Load schedules
  function loadFromLocalStorage() {
    if (!isLocalStorageAvailable) {
      schedules = inMemorySchedules;
      return;
    }
    try {
      const stored = localStorage.getItem('planflow_schedules');
      if (stored) {
        schedules = JSON.parse(stored);
        // Ensure standard object structure is present
        if (typeof schedules !== 'object' || Array.isArray(schedules)) {
          schedules = {};
        }
      } else {
        schedules = {};
      }
    } catch (e) {
      console.error("Failed to load schedules from LocalStorage:", e);
      schedules = {};
      showToast("Error loading saved data. Starting fresh.", "danger");
    }
  }

  // Save schedules
  function saveToLocalStorage() {
    if (!isLocalStorageAvailable) {
      inMemorySchedules = schedules;
      updateCalendarDots();
      return;
    }
    try {
      localStorage.setItem('planflow_schedules', JSON.stringify(schedules));
      updateCalendarDots();
    } catch (e) {
      console.error("Failed to save schedules to LocalStorage:", e);
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        showToast("Storage full! Export backup and clear old tasks.", "danger");
      } else {
        showToast("Error: Local Storage is disabled.", "danger");
      }
    }
  }

  // Helper: Format Date to YYYY-MM-DD (local timezone safe)
  function formatDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Helper: Human Readable Date Display
  function formatHumanDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const dStr = formatDateString(date);
    if (dStr === formatDateString(today)) return "Today";
    if (dStr === formatDateString(yesterday)) return "Yesterday";
    if (dStr === formatDateString(tomorrow)) return "Tomorrow";

    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
  }

  // Helper: Format 24h Time (HH:MM) to 12h Format with AM/PM
  function formatTime12(timeString) {
    if (!timeString) return '';
    const [hoursStr, minutesStr] = timeString.split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = minutesStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    return `${hours}:${minutes} ${ampm}`;
  }

  // ==========================================
  // DOM ELEMENT REFERENCES
  // ==========================================
  const dateText = document.getElementById('dateText');
  const dateBadge = document.getElementById('dateBadge');
  const calendarGrid = document.getElementById('calendarGrid');
  const calMonthLabel = document.getElementById('calMonthLabel');
  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const todayBtn = document.getElementById('todayBtn');

  const taskList = document.getElementById('taskList');
  const emptyState = document.getElementById('emptyState');
  const statsBar = document.getElementById('statsBar');
  const statTotal = document.getElementById('statTotal');
  const statPending = document.getElementById('statPending');
  const statCompleted = document.getElementById('statCompleted');

  const addTaskFab = document.getElementById('addTaskFab');
  const taskModalOverlay = document.getElementById('taskModalOverlay');
  const taskModalCard = document.getElementById('taskModalCard');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const taskForm = document.getElementById('taskForm');
  const editTaskId = document.getElementById('editTaskId');

  const taskTitle = document.getElementById('taskTitle');
  const taskDesc = document.getElementById('taskDesc');
  const taskStartDate = document.getElementById('taskStartDate');
  const taskEndDate = document.getElementById('taskEndDate');
  const taskStartTime = document.getElementById('taskStartTime');
  const taskEndTime = document.getElementById('taskEndTime');
  const statusPending = document.getElementById('statusPending');
  const statusCompleted = document.getElementById('statusCompleted');
  const taskReminder = document.getElementById('taskReminder');
  const reminderOffset = document.getElementById('reminderOffset');
  const overlapWarning = document.getElementById('overlapWarning');

  // Dropdown menu elements
  const moreMenuBtn = document.getElementById('moreMenuBtn');
  const moreDropdown = document.getElementById('moreDropdown');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');
  const clearAllBtn = document.getElementById('clearAllBtn');

  // Search elements
  const searchToggleBtn = document.getElementById('searchToggleBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchInput = document.getElementById('searchInput');
  const searchCloseBtn = document.getElementById('searchCloseBtn');
  const searchResults = document.getElementById('searchResults');

  // Confirm dialog elements
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmDesc = document.getElementById('confirmDesc');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  const confirmOkBtn = document.getElementById('confirmOkBtn');

  // Theme elements
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const iconMoon = themeToggleBtn.querySelector('.icon-moon');
  const iconSun = themeToggleBtn.querySelector('.icon-sun');

  // Toast container
  const toastContainer = document.getElementById('toastContainer');

  // Alarm overlay
  const alarmOverlay = document.getElementById('alarmOverlay');
  const alarmTaskName = document.getElementById('alarmTaskName');
  const alarmTaskTime = document.getElementById('alarmTaskTime');
  const alarmDismissBtn = document.getElementById('alarmDismissBtn');
  let alarmAudioCtx = null;
  let alarmSoundInterval = null;

  // ==========================================
  // THEME MANAGEMENT
  // ==========================================
  function initTheme() {
    const savedTheme = localStorage.getItem('planflow_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    try {
      localStorage.setItem('planflow_theme', newTheme);
    } catch (e) {}
    updateThemeIcon(newTheme);
    showToast(`Switched to ${newTheme} mode`, "info");
  }

  function updateThemeIcon(theme) {
    if (theme === 'dark') {
      iconMoon.style.display = 'block';
      iconSun.style.display = 'none';
    } else {
      iconMoon.style.display = 'none';
      iconSun.style.display = 'block';
    }
  }

  themeToggleBtn.addEventListener('click', toggleTheme);

  // ==========================================
  // NOTIFICATION UTILITIES
  // ==========================================
  let isNotificationGranted = false;

  function initNotifications() {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        isNotificationGranted = true;
      }
    } else {
      document.getElementById('notificationGroup').style.display = 'none';
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        isNotificationGranted = true;
        showToast("Reminders enabled successfully!", "success");
      } else {
        isNotificationGranted = false;
        taskReminder.checked = false;
        reminderOffset.style.display = 'none';
        showToast("Notification permission denied.", "warning");
      }
    } catch (err) {
      console.error("Error requesting notification permission:", err);
    }
  }

  taskReminder.addEventListener('change', () => {
    if (taskReminder.checked) {
      if (Notification.permission === 'default') {
        requestNotificationPermission();
      } else if (Notification.permission === 'denied') {
        showToast("Please allow notifications in your browser settings first.", "warning");
        taskReminder.checked = false;
        return;
      }
      reminderOffset.style.display = 'block';
    } else {
      reminderOffset.style.display = 'none';
    }
  });

  // Check schedules constantly to trigger alarms
  function runNotificationScheduler() {
    setInterval(() => {
      if (!isNotificationGranted) return;
      const now = new Date();
      const todayStr = formatDateString(now);
      const dayTasks = schedules[todayStr];
      if (!dayTasks || dayTasks.length === 0) return;

      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      dayTasks.forEach(task => {
        if (!task.reminder || task.status === 'completed' || task.reminderFired) return;

        const [startH, startM] = task.startTime.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const offset = parseInt(task.reminderOffset || 10, 10);

        // Calculate time when the alarm should trigger
        const triggerMinutes = startMinutes - offset;

        if (currentMinutes >= triggerMinutes && currentMinutes < startMinutes) {
          triggerBrowserNotification(task);
          task.reminderFired = true; // Mark as fired so it doesn't trigger repeatedly
          saveToLocalStorage();
        }
      });
    }, 15000); // Check every 15 seconds for precision
  }

  function playAlarmSound() {
    try {
      alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      let beepCount = 0;
      function doBeep() {
        if (!alarmAudioCtx) return;
        const oscillator = alarmAudioCtx.createOscillator();
        const gainNode = alarmAudioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(alarmAudioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, alarmAudioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, alarmAudioCtx.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.6, alarmAudioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, alarmAudioCtx.currentTime + 0.4);
        oscillator.start(alarmAudioCtx.currentTime);
        oscillator.stop(alarmAudioCtx.currentTime + 0.4);
        beepCount++;
        if (beepCount >= 12) stopAlarmSound();
      }
      doBeep();
      alarmSoundInterval = setInterval(doBeep, 600);
    } catch(e) {
      console.warn('Audio playback failed:', e);
    }
  }

  function stopAlarmSound() {
    if (alarmSoundInterval) { clearInterval(alarmSoundInterval); alarmSoundInterval = null; }
    if (alarmAudioCtx) { try { alarmAudioCtx.close(); } catch(e){} alarmAudioCtx = null; }
  }

  function showAlarmOverlay(task) {
    alarmTaskName.textContent = task.title;
    alarmTaskTime.textContent = `Starts at ${formatTime12(task.startTime)}${task.description ? ' · ' + task.description : ''}`;
    alarmOverlay.setAttribute('aria-hidden', 'false');
    alarmOverlay.classList.add('show');
    playAlarmSound();
  }

  function dismissAlarm() {
    alarmOverlay.setAttribute('aria-hidden', 'true');
    alarmOverlay.classList.remove('show');
    stopAlarmSound();
  }

  alarmDismissBtn.addEventListener('click', dismissAlarm);
  alarmOverlay.addEventListener('click', (e) => { if (e.target === alarmOverlay) dismissAlarm(); });

  function triggerBrowserNotification(task) {
    showAlarmOverlay(task);
    // Also try native desktop notification as bonus
    const timeFormatted = formatTime12(task.startTime);
    const options = {
      body: `Starts at ${timeFormatted}. ${task.description || ''}`,
      tag: task.id,
      icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="%236366f1" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };
    try {
      const notification = new Notification(`Reminder: ${task.title}`, options);
      notification.onclick = () => { window.focus(); };
    } catch (e) {
      console.warn("Desktop notification not available.");
    }
  }

  // ==========================================
  // TOAST NOTIFICATIONS
  // ==========================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'danger') icon = '🚨';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${escapeHTML(message)}</span>
    `;

    toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 4000);
  }

  // ==========================================
  // CUSTOM DIALOG CONFIRMATIONS
  // ==========================================
  function openConfirmDialog(title, description, onConfirm) {
    confirmTitle.textContent = title;
    confirmDesc.textContent = description;
    confirmOverlay.setAttribute('aria-hidden', 'false');
    confirmOverlay.classList.add('show');
    confirmCallback = onConfirm;

    // Accessibility trap
    trapFocus(confirmOverlay);
    confirmOkBtn.focus();
  }

  function closeConfirmDialog() {
    confirmOverlay.setAttribute('aria-hidden', 'true');
    confirmOverlay.classList.remove('show');
    confirmCallback = null;
    addTaskFab.focus();
  }

  confirmCancelBtn.addEventListener('click', closeConfirmDialog);
  confirmOkBtn.addEventListener('click', () => {
    if (confirmCallback) {
      confirmCallback();
    }
    closeConfirmDialog();
  });

  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirmDialog();
  });

  // ==========================================
  // MODAL ACCESSIBILITY & FOCUS TRAP
  // ==========================================
  function trapFocus(element) {
    const focusableElements = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];

    element.addEventListener('keydown', function(e) {
      const isTabPressed = e.key === 'Tab';

      if (!isTabPressed) {
        return;
      }

      if (e.shiftKey) { // Shift + Tab
        if (document.activeElement === firstFocusableElement) {
          lastFocusableElement.focus();
          e.preventDefault();
        }
      } else { // Tab
        if (document.activeElement === lastFocusableElement) {
          firstFocusableElement.focus();
          e.preventDefault();
        }
      }
    });
  }

  // ==========================================
  // TIME OVERLAP ALERTS
  // ==========================================
  function checkTimeOverlap() {
    const startVal = taskStartTime.value;
    const endVal = taskEndTime.value;
    if (!startVal || !endVal) {
      overlapWarning.style.display = 'none';
      return;
    }

    const dateKey = formatDateString(currentDate);
    const dayTasks = schedules[dateKey] || [];
    const editingId = editTaskId.value;

    const [startH, startM] = startVal.split(':').map(Number);
    const [endH, endM] = endVal.split(':').map(Number);
    const newStart = startH * 60 + startM;
    const newEnd = endH * 60 + endM;

    let hasOverlap = false;

    for (let i = 0; i < dayTasks.length; i++) {
      const t = dayTasks[i];
      if (t.id === editingId) continue; // Skip self if editing

      const [sH, sM] = t.startTime.split(':').map(Number);
      const [eH, eM] = t.endTime.split(':').map(Number);
      const taskStart = sH * 60 + sM;
      const taskEnd = eH * 60 + eM;

      // Overlap condition: start times overlapping or inside interval
      if (newStart < taskEnd && newEnd > taskStart) {
        hasOverlap = true;
        break;
      }
    }

    if (hasOverlap) {
      overlapWarning.style.display = 'flex';
    } else {
      overlapWarning.style.display = 'none';
    }
  }

  taskStartTime.addEventListener('input', checkTimeOverlap);
  taskEndTime.addEventListener('input', checkTimeOverlap);

  // ==========================================
  // MODAL LOGIC (ADD / EDIT)
  // ==========================================
  let currentModalStatus = 'pending';

  function openTaskModal(editTask = null) {
    taskForm.reset();
    resetValidationErrors();
    overlapWarning.style.display = 'none';
    taskModalOverlay.setAttribute('aria-hidden', 'false');
    taskModalOverlay.classList.add('show');
    taskTitle.focus();

    // Trap focus inside modal
    trapFocus(taskModalOverlay);

    // Pre-fill start date with currently selected day
    const todayISO = formatDateString(currentDate);

    if (editTask) {
      modalTitle.textContent = "Edit Task";
      editTaskId.value = editTask.id;
      taskTitle.value = editTask.title;
      taskDesc.value = editTask.description || '';
      taskStartDate.value = editTask.startDate || todayISO;
      taskEndDate.value = editTask.endDate || '';
      taskStartTime.value = editTask.startTime;
      taskEndTime.value = editTask.endTime;
      currentModalStatus = editTask.status || 'pending';
      taskReminder.checked = !!editTask.reminder;
      if (editTask.reminder) {
        reminderOffset.style.display = 'block';
        reminderOffset.value = editTask.reminderOffset || '10';
      } else {
        reminderOffset.style.display = 'none';
      }
      checkTimeOverlap();
    } else {
      modalTitle.textContent = "Add Task";
      editTaskId.value = "";
      currentModalStatus = 'pending';
      reminderOffset.style.display = 'none';
      taskStartDate.value = todayISO;
      taskEndDate.value = '';

      const now = new Date();
      const currentH = now.getHours();
      const startH = String(currentH).padStart(2, '0');
      const endH = String((currentH + 1) % 24).padStart(2, '0');
      taskStartTime.value = `${startH}:00`;
      taskEndTime.value = `${endH}:00`;
    }

    updateStatusToggleButtonGroup();
  }

  function closeTaskModal() {
    taskModalOverlay.setAttribute('aria-hidden', 'true');
    taskModalOverlay.classList.remove('show');
    addTaskFab.focus();
  }

  function updateStatusToggleButtonGroup() {
    if (currentModalStatus === 'pending') {
      statusPending.classList.add('active');
      statusCompleted.classList.remove('active');
    } else {
      statusPending.classList.remove('active');
      statusCompleted.classList.add('active');
    }
  }

  statusPending.addEventListener('click', () => {
    currentModalStatus = 'pending';
    updateStatusToggleButtonGroup();
  });

  statusCompleted.addEventListener('click', () => {
    currentModalStatus = 'completed';
    updateStatusToggleButtonGroup();
  });

  addTaskFab.addEventListener('click', () => openTaskModal());
  modalCloseBtn.addEventListener('click', closeTaskModal);
  cancelModalBtn.addEventListener('click', closeTaskModal);
  taskModalOverlay.addEventListener('click', (e) => {
    if (e.target === taskModalOverlay) closeTaskModal();
  });

  // Key navigation for accessibility
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTaskModal();
      closeConfirmDialog();
      closeSearch();
      closeMoreMenu();
    }
  });

  // Form Validation and submission
  function resetValidationErrors() {
    taskTitle.classList.remove('invalid');
    taskStartDate.classList.remove('invalid');
    taskStartTime.classList.remove('invalid');
    taskEndTime.classList.remove('invalid');
    document.getElementById('titleError').style.display = 'none';
    document.getElementById('startDateError').style.display = 'none';
    document.getElementById('startTimeError').style.display = 'none';
    document.getElementById('endTimeError').style.display = 'none';
  }

  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    resetValidationErrors();

    let isValid = true;

    // Check title
    if (!taskTitle.value.trim()) {
      taskTitle.classList.add('invalid');
      document.getElementById('titleError').textContent = "Title is required";
      document.getElementById('titleError').style.display = 'block';
      isValid = false;
    }

    // Check Start date
    if (!taskStartDate.value) {
      taskStartDate.classList.add('invalid');
      document.getElementById('startDateError').textContent = "Start date is required";
      document.getElementById('startDateError').style.display = 'block';
      isValid = false;
    }

    // Check Start time
    if (!taskStartTime.value) {
      taskStartTime.classList.add('invalid');
      document.getElementById('startTimeError').textContent = "Start time is required";
      document.getElementById('startTimeError').style.display = 'block';
      isValid = false;
    }

    // Check End time
    if (!taskEndTime.value) {
      taskEndTime.classList.add('invalid');
      document.getElementById('endTimeError').textContent = "End time is required";
      document.getElementById('endTimeError').style.display = 'block';
      isValid = false;
    }

    // Validate sequence
    if (taskStartTime.value && taskEndTime.value) {
      const [startH, startM] = taskStartTime.value.split(':').map(Number);
      const [endH, endM] = taskEndTime.value.split(':').map(Number);
      const startTotal = startH * 60 + startM;
      const endTotal = endH * 60 + endM;

      if (endTotal <= startTotal) {
        taskEndTime.classList.add('invalid');
        document.getElementById('endTimeError').textContent = "End time must be after start time";
        document.getElementById('endTimeError').style.display = 'block';
        isValid = false;
      }
    }

    if (!isValid) return;

    const startDateVal = taskStartDate.value;
    const endDateVal = taskEndDate.value || startDateVal;

    // Collect all dates in range
    function getDateRange(start, end) {
      const dates = [];
      const cur = new Date(start + 'T00:00:00');
      const last = new Date(end + 'T00:00:00');
      while (cur <= last) {
        dates.push(formatDateString(cur));
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    }

    const dateRange = getDateRange(startDateVal, endDateVal);
    const taskId = editTaskId.value || 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const isMultiDay = dateRange.length > 1;

    const taskData = {
      id: taskId,
      title: taskTitle.value.trim(),
      description: taskDesc.value.trim(),
      startDate: startDateVal,
      endDate: endDateVal,
      startTime: taskStartTime.value,
      endTime: taskEndTime.value,
      status: currentModalStatus,
      reminder: taskReminder.checked,
      reminderOffset: reminderOffset.value,
      reminderFired: false,
      isMultiDay: isMultiDay,
      totalDays: dateRange.length
    };

    if (editTaskId.value) {
      // For edit: only update the day being viewed (single-day update)
      const dateKey = formatDateString(currentDate);
      if (!schedules[dateKey]) schedules[dateKey] = [];
      const index = schedules[dateKey].findIndex(t => t.id === taskId);
      if (index > -1) {
        const prevTask = schedules[dateKey][index];
        taskData.reminderFired = (prevTask.startTime === taskData.startTime && prevTask.endTime === taskData.endTime) ? prevTask.reminderFired : false;
        schedules[dateKey][index] = taskData;
        showToast("Task updated successfully", "success");
      }
    } else {
      // Add across all dates in range
      dateRange.forEach((dateKey, idx) => {
        if (!schedules[dateKey]) schedules[dateKey] = [];
        const dayTask = { ...taskData, id: idx === 0 ? taskId : 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5) };
        schedules[dateKey].push(dayTask);
      });
      if (isMultiDay) {
        showToast(`Task added across ${dateRange.length} days 📅`, "success");
      } else {
        showToast("Task added successfully", "success");
      }
    }

    // Auto sort tasks by start time for each affected date
    dateRange.forEach(dateKey => {
      if (schedules[dateKey]) {
        schedules[dateKey].sort((a, b) => {
          const [ah, am] = a.startTime.split(':').map(Number);
          const [bh, bm] = b.startTime.split(':').map(Number);
          return (ah * 60 + am) - (bh * 60 + bm);
        });
      }
    });

    saveToLocalStorage();
    closeTaskModal();
    renderDayTasks();
    updateCalendarGrid();
  });

  // ==========================================
  // RENDER TASK LISTS
  // ==========================================
  function renderDayTasks() {
    const dateKey = formatDateString(currentDate);
    const dayTasks = schedules[dateKey] || [];

    dateText.textContent = formatHumanDate(currentDate);
    dateBadge.textContent = currentDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

    if (dayTasks.length > 0) {
      statsBar.style.display = 'flex';
      const total = dayTasks.length;
      const completed = dayTasks.filter(t => t.status === 'completed').length;
      const pending = total - completed;

      statTotal.textContent = total;
      statPending.textContent = pending;
      statCompleted.textContent = completed;
      
      emptyState.style.display = 'none';
      emptyState.setAttribute('aria-hidden', 'true');
      taskList.style.display = 'flex';
    } else {
      statsBar.style.display = 'none';
      taskList.style.display = 'none';
      emptyState.style.display = 'flex';
      emptyState.setAttribute('aria-hidden', 'false');
      return;
    }

    taskList.innerHTML = "";

    dayTasks.forEach(task => {
      const isCompleted = task.status === 'completed';
      
      const card = document.createElement('div');
      card.className = `task-card ${isCompleted ? 'completed' : ''}`;
      card.setAttribute('role', 'listitem');
      card.dataset.id = task.id;

      let reminderBadge = '';
      if (task.reminder) {
        reminderBadge = `
          <span class="task-reminder-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            ${task.reminderOffset}m before
          </span>
        `;
      }

      let multiDayBadge = '';
      if (task.isMultiDay && task.totalDays > 1) {
        multiDayBadge = `
          <span class="task-multiday-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${task.totalDays} days
          </span>
        `;
      }

      card.innerHTML = `
        <div class="task-checkbox-wrapper">
          <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} aria-label="Toggle status for ${escapeHTML(task.title)}" />
        </div>
        <div class="task-details">
          <div class="task-title-row">
            <span class="task-title">${escapeHTML(task.title)}</span>
          </div>
          ${task.description ? `<p class="task-desc">${escapeHTML(task.description)}</p>` : ''}
          <div class="task-meta">
            <span class="task-time">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${formatTime12(task.startTime)} - ${formatTime12(task.endTime)}
            </span>
            ${reminderBadge}
            ${multiDayBadge}
          </div>
        </div>
        <div class="task-actions">
          <button class="action-btn edit-btn" aria-label="Edit task">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="action-btn delete-btn" aria-label="Delete task">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `;

      // Event: Toggle status checkbox
      const checkbox = card.querySelector('.task-checkbox');
      checkbox.addEventListener('change', () => {
        task.status = checkbox.checked ? 'completed' : 'pending';
        if (!checkbox.checked) {
          task.reminderFired = false;
        }
        saveToLocalStorage();
        renderDayTasks();
        updateCalendarGrid();
      });

      // Event: Edit Button
      card.querySelector('.edit-btn').addEventListener('click', () => {
        openTaskModal(task);
      });

      // Event: Delete Button
      card.querySelector('.delete-btn').addEventListener('click', () => {
        openConfirmDialog(
          "Delete Task?",
          `Are you sure you want to delete "${task.title}"?`,
          () => {
            schedules[dateKey] = dayTasks.filter(t => t.id !== task.id);
            if (schedules[dateKey].length === 0) {
              delete schedules[dateKey];
            }
            saveToLocalStorage();
            renderDayTasks();
            updateCalendarGrid();
            showToast("Task deleted", "warning");
          }
        );
      });

      taskList.appendChild(card);
    });
  }

  // Escape HTML utility to prevent XSS
  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  // ==========================================
  // YEARLY MONTHLY CALENDAR GRID ENGINE
  // ==========================================
  function updateCalendarGrid() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    // Set header month label
    calMonthLabel.textContent = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Generate Calendar days
    calendarGrid.innerHTML = "";

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    // 1. Fill previous month's trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayBtn = document.createElement('div');
      dayBtn.className = 'cal-day empty';
      calendarGrid.appendChild(dayBtn);
    }

    // 2. Fill current month's active days
    const todayStr = formatDateString(new Date());
    const selectedStr = formatDateString(currentDate);

    for (let day = 1; day <= totalDays; day++) {
      const dateObj = new Date(year, month, day);
      const dateKey = formatDateString(dateObj);

      const dayBtn = document.createElement('button');
      dayBtn.className = 'cal-day';
      dayBtn.textContent = day;
      dayBtn.setAttribute('aria-label', dateObj.toLocaleDateString('en-US', { dateStyle: 'full' }));

      if (dateKey === todayStr) {
        dayBtn.classList.add('today');
      }

      if (dateKey === selectedStr) {
        dayBtn.classList.add('selected');
      }

      const dayTasks = schedules[dateKey] || [];
      if (dayTasks.length > 0) {
        const dotContainer = document.createElement('div');
        dotContainer.className = 'cal-dot-container';
        
        const visibleTasks = dayTasks.slice(0, 3);
        visibleTasks.forEach(t => {
          const dot = document.createElement('span');
          dot.className = `cal-dot ${t.status === 'completed' ? 'completed' : ''}`;
          dotContainer.appendChild(dot);
        });

        dayBtn.appendChild(dotContainer);
      }

      dayBtn.addEventListener('click', () => {
        currentDate = new Date(year, month, day);
        document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
        dayBtn.classList.add('selected');
        renderDayTasks();
      });

      calendarGrid.appendChild(dayBtn);
    }
  }

  function updateCalendarDots() {
    updateCalendarGrid();
  }

  // Monthly Navigation Handlers
  prevMonthBtn.addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    updateCalendarGrid();
  });

  nextMonthBtn.addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    updateCalendarGrid();
  });

  todayBtn.addEventListener('click', () => {
    currentDate = new Date();
    calendarDate = new Date(currentDate);
    updateCalendarGrid();
    renderDayTasks();
    showToast("Selected current day", "info");
  });

  // ==========================================
  // MORE DROPDOWN MENU HANDLERS
  // ==========================================
  function toggleMoreMenu() {
    const isShown = moreDropdown.classList.contains('show');
    if (isShown) {
      closeMoreMenu();
    } else {
      moreDropdown.classList.add('show');
      moreDropdown.setAttribute('aria-hidden', 'false');
      moreMenuBtn.setAttribute('aria-expanded', 'true');
      trapFocus(moreDropdown);
    }
  }

  function closeMoreMenu() {
    moreDropdown.classList.remove('show');
    moreDropdown.setAttribute('aria-hidden', 'true');
    moreMenuBtn.setAttribute('aria-expanded', 'false');
  }

  moreMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMoreMenu();
  });

  document.addEventListener('click', () => {
    closeMoreMenu();
  });

  // Export schedules as JSON backup file
  exportBtn.addEventListener('click', () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(schedules, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      
      const fileDate = formatDateString(new Date());
      downloadAnchor.setAttribute("download", `planflow_backup_${fileDate}.json`);
      
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast("Data backup file exported", "success");
    } catch (err) {
      console.error(err);
      showToast("Export failed.", "danger");
    }
  });

  // Import JSON backup file
  importBtn.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const importedData = JSON.parse(evt.target.result);
        
        if (typeof importedData !== 'object' || Array.isArray(importedData)) {
          throw new Error("Invalid structure.");
        }

        // Schema validation for robustness
        let totalCount = 0;
        for (const dateKey in importedData) {
          // Verify key pattern matches YYYY-MM-DD
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            throw new Error(`Invalid date format string: ${dateKey}`);
          }
          if (!Array.isArray(importedData[dateKey])) {
            throw new Error(`Tasks for ${dateKey} is not an Array.`);
          }

          // Validate individual tasks
          importedData[dateKey].forEach(t => {
            if (!t.title || typeof t.title !== 'string') {
              throw new Error(`Missing task title in ${dateKey}`);
            }
            if (!t.startTime || !t.endTime) {
              throw new Error(`Missing task start/end times in ${dateKey}`);
            }
          });

          totalCount += importedData[dateKey].length;
        }

        openConfirmDialog(
          "Import schedules?",
          `This will merge ${totalCount} tasks from file into your current plans. Continue?`,
          () => {
            for (const dateKey in importedData) {
              if (!schedules[dateKey]) {
                schedules[dateKey] = [];
              }
              importedData[dateKey].forEach(impTask => {
                const isDuplicate = schedules[dateKey].some(t => t.id === impTask.id || (t.title === impTask.title && t.startTime === impTask.startTime));
                if (!isDuplicate) {
                  schedules[dateKey].push(impTask);
                }
              });
              
              schedules[dateKey].sort((a, b) => {
                const [ah, am] = a.startTime.split(':').map(Number);
                const [bh, bm] = b.startTime.split(':').map(Number);
                return (ah * 60 + am) - (bh * 60 + bm);
              });
            }
            saveToLocalStorage();
            renderDayTasks();
            updateCalendarGrid();
            showToast("Backup imported successfully!", "success");
          }
        );
      } catch (err) {
        showToast("Error: Invalid backup JSON file format.", "danger");
        console.error(err);
      }
    };
    reader.readAsText(file);
    importFileInput.value = "";
  });

  // Clear all planner data
  clearAllBtn.addEventListener('click', () => {
    openConfirmDialog(
      "Clear All Data?",
      "Are you absolutely sure you want to permanently delete all tasks and schedules? This cannot be undone.",
      () => {
        schedules = {};
        saveToLocalStorage();
        renderDayTasks();
        updateCalendarGrid();
        showToast("All schedules cleared.", "warning");
      }
    );
  });

  // ==========================================
  // SEARCH OVERLAY AND LOGIC
  // ==========================================
  function openSearch() {
    searchOverlay.setAttribute('aria-hidden', 'false');
    searchOverlay.classList.add('show');
    searchInput.focus();
    trapFocus(searchOverlay);
    performSearch();
  }

  function closeSearch() {
    searchOverlay.setAttribute('aria-hidden', 'true');
    searchOverlay.classList.remove('show');
    searchInput.value = "";
    searchResults.innerHTML = "";
    addTaskFab.focus();
  }

  searchToggleBtn.addEventListener('click', openSearch);
  searchCloseBtn.addEventListener('click', closeSearch);
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch();
  });

  searchInput.addEventListener('input', performSearch);

  function performSearch() {
    const query = searchInput.value.trim().toLowerCase();
    searchResults.innerHTML = "";

    if (!query) {
      searchResults.innerHTML = '<div class="search-results-empty">Type keywords above to find tasks...</div>';
      return;
    }

    const matches = [];

    for (const dateKey in schedules) {
      schedules[dateKey].forEach(task => {
        const titleMatch = task.title.toLowerCase().includes(query);
        const descMatch = (task.description || '').toLowerCase().includes(query);

        if (titleMatch || descMatch) {
          matches.push({
            dateStr: dateKey,
            task: task
          });
        }
      });
    }

    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="search-results-empty">No matching tasks found.</div>';
      return;
    }

    matches.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    const groupedMatches = {};
    matches.forEach(item => {
      if (!groupedMatches[item.dateStr]) {
        groupedMatches[item.dateStr] = [];
      }
      groupedMatches[item.dateStr].push(item.task);
    });

    for (const dateKey in groupedMatches) {
      const groupEl = document.createElement('div');
      groupEl.className = 'search-result-group';

      const parsedDate = new Date(dateKey + 'T00:00:00');
      
      const dateLabel = document.createElement('div');
      dateLabel.className = 'search-result-date';
      dateLabel.textContent = parsedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      groupEl.appendChild(dateLabel);

      groupedMatches[dateKey].forEach(task => {
        const itemEl = document.createElement('div');
        const isCompleted = task.status === 'completed';
        itemEl.className = `task-card ${isCompleted ? 'completed' : ''}`;
        
        itemEl.innerHTML = `
          <div style="grid-column: 1 / span 3; display: flex; flex-direction: column; gap: 4px;">
            <div class="task-title-row">
              <span class="task-title">${escapeHTML(task.title)}</span>
            </div>
            ${task.description ? `<p class="task-desc">${escapeHTML(task.description)}</p>` : ''}
            <div class="task-meta">
              <span class="task-time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${formatTime12(task.startTime)} - ${formatTime12(task.endTime)}
              </span>
              <span class="task-time" style="background: transparent; border: 1px solid var(--border-glass); color: var(--text-muted);">
                Go to Date ↗
              </span>
            </div>
          </div>
        `;

        itemEl.addEventListener('click', () => {
          currentDate = new Date(dateKey + 'T00:00:00');
          calendarDate = new Date(currentDate);
          closeSearch();
          updateCalendarGrid();
          renderDayTasks();
          
          setTimeout(() => {
            const cardEl = document.querySelector(`.task-card[data-id="${task.id}"]`);
            if (cardEl) {
              cardEl.style.boxShadow = '0 0 16px var(--accent)';
              cardEl.style.borderColor = 'var(--accent)';
              cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => {
                cardEl.style.boxShadow = '';
                cardEl.style.borderColor = '';
              }, 1200);
            }
          }, 300);
        });

        groupEl.appendChild(itemEl);
      });

      searchResults.appendChild(groupEl);
    }
  }

  // ==========================================
  // INITIALIZE APPLICATION STATE
  // ==========================================
  initTheme();
  initNotifications();
  loadFromLocalStorage();
  updateCalendarGrid();
  renderDayTasks();
  runNotificationScheduler();
});
