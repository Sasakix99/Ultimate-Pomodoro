/* ========= Utilitaires ========= */
function parseDurationToSeconds(str){
  if(!str) return null;
  str = String(str).trim().toLowerCase();
  if(str === '') return null;

  // h:mm
  if(str.includes(':')){
    var parts = str.split(':');
    var h = parseInt(parts[0],10) || 0;
    var m = parseInt(parts[1],10) || 0;
    return (h*60 + m) * 60;
  }
  // suffixes 2h15, 90m, 2h, 45m
  var hMatch = str.match(/(\d+)\s*h/);
  var mMatch = str.match(/(\d+)\s*m/);
  if(hMatch || mMatch){
    var h = hMatch ? parseInt(hMatch[1],10) : 0;
    var m = mMatch ? parseInt(mMatch[1],10) : 0;
    return (h*60 + m) * 60;
  }
  // nombre brut = minutes
  var n = parseInt(str,10);
  if(!isNaN(n)) return n*60;

  return null;
}
function formatHMSfromSeconds(sec){
  sec = Math.max(0, Math.round(sec));
  var h=Math.floor(sec/3600), m=Math.floor((sec-h*3600)/60), s=sec-h*3600-m*60;
  if(s<10&&m>0)s='0'+s; if(m<10&&h>0)m='0'+m;
  var t=(h===0)?(m+':'+s):(h+':'+m+':'+s); if(h===0&&m===0)t=s;
  return t;
}
function formatTimeOfDay(date){
  const hh = date.getHours();
  const mm = date.getMinutes();
  const H = (hh < 10 ? '0' : '') + hh;
  const M = (mm < 10 ? '0' : '') + mm;
  return `${H}h${M}`; // 24h
}
/* Units minuscules pour Focus & Restant */
function formatHMSUnitsLower(sec){
  sec = Math.max(0, Math.round(sec));
  var h = Math.floor(sec/3600);
  var m = Math.floor((sec - h*3600)/60);
  var s = sec - h*3600 - m*60;
  if(h > 0) return `${h}h${m}m${s}s`;
  if(m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/* ========= État ========= */
var startSeconds,
    totalFocusMinutes = 0,
    sessionsCompleted = 0,
    tickTimer = null;

var currentMode = 'task';
var taskInitialSeconds = null;
var taskCountedSeconds = 0;

var targetEndTime = null;
var lastShownSeconds = null;
var pausedRemainingSeconds = null;

var RADIUS=80, CIRCUMFERENCE=2*Math.PI*RADIUS;

/* === Nouveaux snapshots pour la PAUSE === */
var pausedFocusedSecSnapshot = null;       // focus effectif au moment de la pause
var pausedRemainingFocusSecSnapshot = null; // temps de focus restant (objectif) au moment de la pause

function isPaused(){
  return (targetEndTime==null && pausedRemainingSeconds!=null);
}

/* ========= Sons ========= */
var dingTaskEnd  = new Audio("https://files.catbox.moe/86hbuo.mp3");
var dingBreakEnd = new Audio("https://files.catbox.moe/am7eme.mp3");
function play(audio){ try{ audio.currentTime=0; audio.play().catch(()=>{});}catch(e){} }

/* ========= Anneau + affichage ========= */
function updateRing(p){
  p=Math.max(0,Math.min(1,p));
  var off=CIRCUMFERENCE*(1-p);
  var ring = document.getElementById('ringProgress');
  if(!ring) return;
  ring.setAttribute('stroke-dasharray', CIRCUMFERENCE);
  ring.setAttribute('stroke-dashoffset', off);
}
function showClock(sec){
  var el = document.getElementById('clockTime');
  if(!el) return;
  el.innerHTML = formatHMSfromSeconds(sec);
  if(startSeconds){ updateRing(1-(sec/startSeconds)); }
}

/* ========= Init ========= */
$(function(){
  // Défauts
  $('#goalTimeInput').val('10h');
  $('#sessionLengthInput').val('2h');
  $('#breakLengthInput').val('25m');

  renderSessions();
  renderFocus();
  renderCompletedMinutes();    // minutes
  updateRing(0);

  // Cadran initial
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 2*3600;
  startSeconds = sessionS;
  showClock(sessionS);

  $('#perpetual').prop('checked', true);
  document.addEventListener('visibilitychange', hardUpdateFromNow);

  $('#goalTimeInput, #sessionLengthInput, #breakLengthInput').on('input', function(){
    if(targetEndTime==null && pausedRemainingSeconds==null && currentMode==='task'){
      var ss = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
      startSeconds = ss>0? ss : 0;
      showClock(startSeconds);
      updateRing(0);
    }
    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();
  });

  updateStatsUI();
});

/* ========= Tick ========= */
function startTick(){ stopTick(); lastShownSeconds=null; tickTimer=setInterval(tick,250); tick(); }
function stopTick(){ if(tickTimer){ clearInterval(tickTimer); tickTimer=null; } }
function secondsRemainingNow(){
  if(targetEndTime==null) return pausedRemainingSeconds ?? 0;
  var ms=Math.max(0,targetEndTime-Date.now());
  return Math.round(ms/1000);
}
function hardUpdateFromNow(){
  if(targetEndTime==null) return;
  var sec=secondsRemainingNow();
  showClock(sec);
  if(sec===0) onSegmentEnd();
  updateStatsUI();
  renderFocus();
  renderCompletedMinutes();
}
function tick(){
  if(targetEndTime==null) return;
  var sec=secondsRemainingNow();
  if(lastShownSeconds===null||sec!==lastShownSeconds){
    showClock(sec);
    lastShownSeconds=sec;
    if(sec===0) onSegmentEnd();
    updateStatsUI();
    renderFocus();
    renderCompletedMinutes();
  }
}

/* ========= Focus effectif ========= */
function effectiveFocusSeconds(){
  // Si PAUSE → renvoyer le snapshot figé
  if(isPaused() && pausedFocusedSecSnapshot!=null){
    return pausedFocusedSecSnapshot;
  }

  var base = totalFocusMinutes*60;
  if(currentMode==='task' && taskInitialSeconds!=null){
    var remaining = secondsRemainingNow();
    var remainingForElapsed = (targetEndTime==null && pausedRemainingSeconds!=null) ? pausedRemainingSeconds : remaining;
    if(typeof remainingForElapsed !== 'number') remainingForElapsed = 0;

    var elapsedThisTask = taskInitialSeconds - Math.max(0, remainingForElapsed);
    elapsedThisTask = Math.max(0, elapsedThisTask - taskCountedSeconds);
    base += elapsedThisTask;
  }
  return Math.max(0, base);
}

/* ========= UI ========= */
function renderFocus(){
  var sec = effectiveFocusSeconds();
  document.getElementById('focusValue').textContent = formatHMSUnitsLower(sec);
}
/* minutes seules dans Adjust Time */
function renderCompletedMinutes(){
  var sec = effectiveFocusSeconds();
  var minutes = Math.floor(sec / 60); // entier en minutes
  document.getElementById('completedMinutesValue').textContent = minutes;
}
function renderSessions(){
  document.getElementById('sessionsValue').textContent = String(sessionsCompleted);
}

/* ========= Play / Pause ========= */
$('#playPauseButton').click(function(){
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  if($(this).hasClass('fa-pause')){
    // === PAUSE ===
    $(this).attr('class','fa fa-play fa-stack-1x');

    var remaining = secondsRemainingNow();
    pausedRemainingSeconds = remaining;
    targetEndTime = null;
    stopTick();

    // Mettre à jour les minutes/focus validés jusque la pause
    if(currentMode==='task' && taskInitialSeconds!=null){
      var elapsed = taskInitialSeconds - remaining - taskCountedSeconds;
      if(elapsed>0){
        taskCountedSeconds += elapsed;
        totalFocusMinutes += Math.round(elapsed/60);
      }
    }

    // Créer les snapshots PAUSE (figer les valeurs affichées)
    pausedFocusedSecSnapshot = effectiveFocusSeconds();

    var goalS = parseDurationToSeconds($('#goalTimeInput').val());
    if(goalS!=null){
      pausedRemainingFocusSecSnapshot = Math.max(0, goalS - pausedFocusedSecSnapshot);
    } else {
      pausedRemainingFocusSecSnapshot = null;
    }

    renderFocus();
    renderCompletedMinutes();
    updateStatsUI();
  } else {
    // === PLAY / RESUME ===
    $(this).attr('class','fa fa-pause fa-stack-1x');

    // On efface les snapshots pour reprendre en live
    pausedFocusedSecSnapshot = null;
    pausedRemainingFocusSecSnapshot = null;

    if(pausedRemainingSeconds != null){
      if(currentMode==='task'){
        if(taskInitialSeconds==null){ taskInitialSeconds = sessionS; }
        startSeconds = taskInitialSeconds;
      } else {
        startSeconds = breakS;
      }
      showClock(pausedRemainingSeconds);
      targetEndTime = Date.now() + pausedRemainingSeconds*1000;
      pausedRemainingSeconds = null;
      startTick();
    } else if(targetEndTime==null){
      if(currentMode==='task'){
        taskInitialSeconds = sessionS;
        taskCountedSeconds = 0;
        startSeconds = taskInitialSeconds;
      } else {
        startSeconds = breakS;
      }
      targetEndTime = Date.now()+startSeconds*1000;
      showClock(startSeconds); updateRing(0);
      startTick();
    } else {
      startTick();
    }
  }
});

/* ========= Reset ========= */
$('#resetClockButton').click(function(){
  stopTick(); targetEndTime=null; startSeconds=null; pausedRemainingSeconds=null;
  pausedFocusedSecSnapshot=null; pausedRemainingFocusSecSnapshot=null;
  $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  currentMode='task'; taskInitialSeconds=null; taskCountedSeconds=0;

  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  startSeconds = sessionS;
  showClock(sessionS); updateRing(0);
  updateStatsUI();
  renderFocus();
  renderCompletedMinutes();
});

/* ========= Fin de segment ========= */
function onSegmentEnd(){
  if(targetEndTime==null) return;
  targetEndTime=null; pausedRemainingSeconds=null; stopTick();
  pausedFocusedSecSnapshot=null; pausedRemainingFocusSecSnapshot=null;

  if(currentMode==='task'){
    var rest=Math.max(0, taskInitialSeconds-taskCountedSeconds);
    if(rest>0){
      totalFocusMinutes+=Math.round(rest/60);
      taskCountedSeconds=taskInitialSeconds;
    }
    play(dingTaskEnd);
    sessionsCompleted += 1;
    renderSessions();
    startNext('break');
  } else {
    play(dingBreakEnd);
    startNext('task');
  }
}

/* ========= Prochain segment ========= */
function startNext(mode){
  currentMode=mode;
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  if(mode==='task'){ taskInitialSeconds=sessionS; taskCountedSeconds=0; startSeconds=taskInitialSeconds; }
  else { startSeconds=breakS; }

  showClock(startSeconds); updateRing(0);

  if($('#perpetual').is(':checked')){
    $('#playPauseButton').attr('class','fa fa-pause fa-stack-1x');
    targetEndTime=Date.now()+startSeconds*1000; startTick();
  } else {
    $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  }
  updateStatsUI();
  renderFocus();
  renderCompletedMinutes();
}

/* ========= Statistiques ========= */
function updateStatsUI(){
  var goalS     = parseDurationToSeconds($('#goalTimeInput').val());
  var sessionS  = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS    = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  // Focus (effectif) & Restant : si PAUSE -> utiliser le snapshot figé
  var focusedSec = isPaused() && pausedFocusedSecSnapshot!=null
      ? pausedFocusedSecSnapshot
      : effectiveFocusSeconds();

  var remainingFocusSec = null;
  if(goalS!=null){
    remainingFocusSec = isPaused() && pausedRemainingFocusSecSnapshot!=null
      ? pausedRemainingFocusSecSnapshot
      : Math.max(0, goalS - focusedSec);
  }

  var sessionsRemaining = null;
  if(goalS!=null && sessionS>0){
    sessionsRemaining = Math.ceil(remainingFocusSec / sessionS);
  }

  var etaText = '—';
  if(remainingFocusSec!=null){
    var breaksCount = sessionsRemaining!=null ? Math.max(0, sessionsRemaining-1) : 0;
    var etaTotalSec = remainingFocusSec + breaksCount*breakS;
    var etaDate = new Date(Date.now() + etaTotalSec*1000);
    etaText = formatTimeOfDay(etaDate);
  }

  document.getElementById('remainingFocusValue').textContent =
    (remainingFocusSec!=null) ? formatHMSUnitsLower(remainingFocusSec) : '—';
  document.getElementById('sessionsRemaining').textContent =
    (sessionsRemaining!=null) ? sessionsRemaining : '—';
  document.getElementById('etaFinish').textContent = etaText;
}