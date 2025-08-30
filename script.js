var startSeconds,
    sessionCount = 0,     // sessions terminées = sessionCount/2
    totalFocusMinutes = 0,
    counter,
    defaultTaskTime = 30,   // << 30 min par défaut
    defaultBreakTime = 10;  // << 10 min par défaut

/* Son fin de TÂCHE (pas de son fin de pause) */
var ding = new Audio("https://files.catbox.moe/86hbuo.mp3");
ding.preload = "auto";
function playDing(){ try{ ding.currentTime=0; ding.play().catch(function(){}); }catch(e){} }

/* Conversion robuste depuis l'affichage (#taskTime / #breakTime) vers secondes */
function displayToSeconds(text){
  text = String(text);
  return (text.indexOf(':') > -1) ? stringToSeconds(text) : Number(text) * 60;
}

/* Anneau (SVG) */
var RADIUS = 80;
var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
function updateRing(progress){               // 0 -> 1
  progress = Math.max(0, Math.min(1, progress));
  var offset = CIRCUMFERENCE * (1 - progress);
  var $ring = $('#ringProgress');
  $ring.css('stroke-dasharray', CIRCUMFERENCE);
  $ring.css('stroke-dashoffset', offset);
}

/* Helpers focus cumulé */
function formatMinutes(mins){
  var h = Math.floor(mins/60), m = mins % 60;
  return h > 0 ? (h + 'h ' + (m<10?'0':'') + m) : (m + 'm');
}
function renderFocus(){ $('#focusValue').text(formatMinutes(totalFocusMinutes)); }

/* Init */
$(document).ready(function () {
  $('#taskTime').html(defaultTaskTime);
  $('#breakTime').html(defaultBreakTime);

  resetClockDisplay();                 // écrit le temps au centre
  updateRing(0);                       // anneau à 0
  $('#sessionsValue').text('0');
  renderFocus();

  $('[data-toggle="tooltip"]').tooltip();

  if (typeof window.orientation !== 'undefined' ||
      navigator.userAgent.match(/mobile/gi) ||
      navigator.userAgent.match(/trident/gi) ||
      navigator.userAgent.match(/edge/gi)) {
    $('#notificationsLabel').css('display', 'none');
  }

  /* Force l’affichage du temps au chargement */
  showTime(displayToSeconds($('#taskTime').html()), 'clockTime');
});

/* Play / Pause */
$('#playPauseButton').click(function () {
  if ($(this).hasClass('fa-pause')) {
    $(this).attr('class','fa fa-play fa-stack-1x');
    clearInterval(counter);
  } else {
    $(this).attr('class','fa fa-pause fa-stack-1x');
    startSeconds = startSeconds || displayToSeconds($('#taskTime').html());
    counter = setInterval(countDown, 1000);
  }
});

/* Reset */
$('#resetClockButton').click(function () {
  clearInterval(counter);
  startSeconds = null;
  sessionCount = 0;
  totalFocusMinutes = 0;
  $('#sessionsValue').text('0');
  renderFocus();
  $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  updateRing(0);
  resetClockDisplay();
});

/* Adjust Task Time (+/-/reset) */
$('#taskTimeUpButton').click(function () {
  var s = displayToSeconds($('#taskTime').html());
  if (s < 7200) { s += 60; showTime(s,'taskTime'); updateClock(s); }
});
$('#taskTimeDownButton').click(function () {
  var s = displayToSeconds($('#taskTime').html());
  if (s > 60) { s -= 60; showTime(s,'taskTime'); updateClock(s); }
});
$('#taskTimeResetButton').click(function () {
  var s = defaultTaskTime * 60;
  $('#taskTime').html(defaultTaskTime);
  showTime(s,'taskTime'); updateClock(s);
});

/* PRÉSETS TASK (1h / 2h) */
$('#taskPreset60').click(function(){
  var s = 60 * 60;
  showTime(s,'taskTime'); updateClock(s);
});
$('#taskPreset120').click(function(){
  var s = 120 * 60;
  showTime(s,'taskTime'); updateClock(s);
});

/* Adjust Break Time (+/-/reset) */
$('#breakTimeUpButton').click(function () {
  var s = displayToSeconds($('#breakTime').html());
  if (s < 7200) { s += 60; showTime(s,'breakTime'); }
});
$('#breakTimeDownButton').click(function () {
  var s = displayToSeconds($('#breakTime').html());
  if (s > 0) { s -= 60; showTime(s,'breakTime'); }
});
$('#breakTimeResetButton').click(function () {
  $('#breakTime').html(defaultBreakTime);
});

/* PRÉSETS BREAK (20/30 min) */
$('#breakPreset20').click(function(){
  var s = 20 * 60; showTime(s,'breakTime');
});
$('#breakPreset30').click(function(){
  var s = 30 * 60; showTime(s,'breakTime');
});

/* Décompte */
function countDown() {
  var time = $('#clockTime').text();

  if (stringToSeconds(time) > 0) {
    var s = stringToSeconds(time) - 1;
    showTime(s,'clockTime');
  }

  if (time === '0') {
    sessionCount++;

    if (sessionCount % 2 === 1) {
      // FIN de tâche -> son + cumul focus + démarrer BREAK
      if ($('#notify').is(':checked')) { notify('Task complete!'); }
      playDing();

      // + minutes de focus = durée task affichée (convertie en secondes -> minutes)
      totalFocusMinutes += Math.round(displayToSeconds($('#taskTime').html()) / 60);
      renderFocus();

      startTimer('break');
    } else {
      // FIN de pause -> retour TÂCHE + maj Sessions
      if ($('#notify').is(':checked') && displayToSeconds($('#breakTime').html()) > 0) {
        notify('Break complete. Start your next task! Sessions: ' + (sessionCount/2));
      }
      $('#sessionsValue').text(String(sessionCount/2));
      startTimer('task');
    }
  }
}

/* Lancer un timer (task/break) */
function startTimer(session) {
  clearInterval(counter);
  startSeconds = displayToSeconds($('#' + session + 'Time').html());
  showTime(startSeconds,'clockTime');
  updateRing(0);
  if ($('#perpetual').is(':checked')) {
    counter = setInterval(countDown, 1000);
  } else {
    $('#playPauseButton').trigger('click');
  }
}

/* Utilitaires temps */
function stringToSeconds(time) {
  var arr = String(time).split(':'), h, m, s;
  if (String(time).indexOf(':') > -1) {
    if (arr.length > 2) { h=+arr[0]; m=+arr[1]; s=+arr[2] + m*60 + h*3600; return s; }
    else { m=+arr[0]; s=+arr[1] + m*60; return s; }
  } else { return +time; }
}

function showTime(seconds, id) {
  var h = Math.floor(seconds/3600),
      m = Math.floor((seconds - h*3600)/60),
      s = seconds - h*3600 - m*60,
      t;

  if (id === 'clockTime') {
    if (s < 10 && m > 0) s = '0' + s;
    if (m < 10 && h > 0) m = '0' + m;
    t = (h===0) ? (m + ':' + s) : (h + ':' + m + ':' + s);
    if (h===0 && m===0) t = s;

    if (startSeconds) {
      var p = 1 - (seconds / startSeconds);
      updateRing(p);
    }
  } else {
    if (h===0) t = m;
    else if (m<10) t = h + ':' + '0' + m;
    else t = h + ':' + m;
  }
  $('#' + id).html(t);
}

function resetClockDisplay(){
  var s = displayToSeconds($('#taskTime').html());
  showTime(s,'clockTime');   // écrit le minuteur dans l’anneau
}

function updateClock(s){
  if (!startSeconds) { showTime(s,'clockTime'); updateRing(0); }
}

/* Notifications */
$('#notify').change(function () {
  if ($('#notify').is(':checked')) {
    if (typeof Notification === 'undefined') {
      alert('Desktop notifications are not supported in this browser.');
      $('#notificationsLabel').css('display','none'); return;
    }
    if (Notification.permission !== 'granted') {
      Notification.requestPermission(function(){
        if (Notification.permission !== 'granted') {
          alert('Desktop notifications are disabled or not supported in your browser.');
          $('#notificationsLabel').css('display','none');
        }
      });
    }
  }
});

function notify(message){
  try {
    new Notification('Pomodoro Timer', {
      icon:'https://farm2.staticflickr.com/1463/25084523152_7b93879cce_o.jpg',
      body:message
    });
  } catch(e) {}
}