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
  return `${H}h${M}`; // ex: 17h45
}

/* === Format compact h/m/s (minuscules) pour Focus & Temps restant ===
   - si h>0 -> "xhymzs" (ex: 10h0m0s)
   - si h==0 & m>0 -> "xm ys"
   - si h==0 & m==0 -> "xs"
*/
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
    totalFocusMinutes = 0,        // minutes validées (accumulées sur pauses/fin de session)
    sessionsCompleted = 0,
    tickTimer = null;

var currentMode = 'task';         // 'task' | 'break'
var taskInitialSeconds = null;    // durée d’une session (s)
var taskCountedSeconds = 0;       // portion déjà ajoutée pour cette session (s)

var targetEndTime = null;         // horodatage de fin segment en cours
var lastShownSeconds = null;
var pausedRemainingSeconds = null;

var RADIUS=80, CIRCUMFERENCE=2*Math.PI*RADIUS;

/* ========= Sons ========= */
var dingTaskEnd  = new Audio("https://files.catbox.moe/86hbuo.mp3");
var dingBreakEnd = new Audio("https://files.catbox.moe/am7eme.mp3");
function play(audio){ try{ audio.currentTime=0; audio.play().catch(()=>{});}catch(e){} }

/* ========= Anneau + affichage ========= */
function updateRing(p){ 
  p=Math.max(0,Math.min(1,p)); 
  var off=CIRCUMFERENCE*(1-p);
  document.getElementById('ringProgress').setAttribute('stroke-dasharray', CIRCUMFERENCE);
  document.getElementById('ringProgress').setAttribute('stroke-dashoffset', off);
}
function showClock(sec){
  document.getElementById('clockTime').innerHTML = formatHMSfromSeconds(sec);
  if(startSeconds){ updateRing(1-(sec/startSeconds)); }
}

/* ========= Init ========= */
$(function(){
  // Valeurs par défaut (doublées côté HTML)
  $('#goalTimeInput').val('10h');
  $('#sessionLengthInput').val('2h');
  $('#breakLengthInput').val('25m');

  renderSessions(); 
  renderFocus();     
  updateRing(0);

  // Cadran initial = durée session
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 2*3600;
  startSeconds = sessionS;
  showClock(sessionS);

  $('#perpetual').prop('checked', true);
  document.addEventListener('visibilitychange', hardUpdateFromNow);

  // Mise à jour live quand on modifie les champs
  $('#goalTimeInput, #sessionLengthInput, #breakLengthInput').on('input', function(){
    if(targetEndTime==null && pausedRemainingSeconds==null && currentMode==='task'){
      var ss = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
      startSeconds = ss>0? ss : 0;
      showClock(startSeconds);
      updateRing(0);
    }
    updateStatsUI();
    renderFocus();
  });

  updateStatsUI();
});

/* ========= Tick / timekeeping ========= */
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
  } 
}

/* ========= Focus effectif (live, sans les pauses) ========= */
function effectiveFocusSeconds(){
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

/* ========= UI basique ========= */
function renderFocus(){ 
  var sec = effectiveFocusSeconds();
  // Affichage compact en minuscules, comme demandé
  document.getElementById('focusValue').textContent = formatHMSUnitsLower(sec);
}
function renderSessions(){ 
  document.getElementById('sessionsValue').textContent = String(sessionsCompleted); 
}

/* ========= Play / Pause ========= */
$('#playPauseButton').click(function(){
  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS   = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  if($(this).hasClass('fa-pause')){
    // PAUSE
    $(this).attr('class','fa fa-play fa-stack-1x');
    var remaining = secondsRemainingNow();
    pausedRemainingSeconds = remaining;
    targetEndTime = null; 
    stopTick();

    if(currentMode==='task' && taskInitialSeconds!=null){
      var elapsed = taskInitialSeconds - remaining - taskCountedSeconds;
      if(elapsed>0){
        taskCountedSeconds += elapsed;
        totalFocusMinutes += Math.round(elapsed/60);
        renderFocus();
      }
    }
    updateStatsUI();
  } else {
    // PLAY / RESUME
    $(this).attr('class','fa fa-pause fa-stack-1x');

    if(pausedRemainingSeconds != null){
      // Reprise
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
      // Démarrage d’un nouveau segment
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
  $('#playPauseButton').attr('class','fa fa-play fa-stack-1x');
  currentMode='task'; taskInitialSeconds=null; taskCountedSeconds=0;

  var sessionS = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  startSeconds = sessionS;
  showClock(sessionS); updateRing(0);
  updateStatsUI();
  renderFocus();
});

/* ========= Fin de segment ========= */
function onSegmentEnd(){
  if(targetEndTime==null) return;
  targetEndTime=null; pausedRemainingSeconds=null; stopTick();

  if(currentMode==='task'){
    var rest=Math.max(0, taskInitialSeconds-taskCountedSeconds);
    if(rest>0){ 
      totalFocusMinutes+=Math.round(rest/60); 
      renderFocus(); 
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
}

/* ========= Statistiques live (haut) ========= */
function updateStatsUI(){
  var goalS     = parseDurationToSeconds($('#goalTimeInput').val());          // objectif global focus
  var sessionS  = parseDurationToSeconds($('#sessionLengthInput').val()) || 0;
  var breakS    = parseDurationToSeconds($('#breakLengthInput').val())   || 0;

  var focusedSec = effectiveFocusSeconds();

  var remainingFocusSec = (goalS!=null) ? Math.max(0, goalS - focusedSec) : null;

  var sessionsRemaining = null;
  if(goalS!=null && sessionS>0){
    sessionsRemaining = Math.ceil(remainingFocusSec / sessionS);
  }

  var etaText = '—';
  if(remainingFocusSec!=null){
    var breaksCount = sessionsRemaining!=null ? Math.max(0, sessionsRemaining-1) : 0;
    var etaTotalSec = remainingFocusSec + breaksCount*breakS;
    var etaDate = new Date(Date.now() + etaTotalSec*1000);
    etaText = formatTimeOfDay(etaDate); // 24h HHhMM
  }

  // Affichage compact en minuscules pour Tps restant
  document.getElementById('remainingFocusValue').textContent =
    (remainingFocusSec!=null) ? formatHMSUnitsLower(remainingFocusSec) : '—';
  document.getElementById('sessionsRemaining').textContent =
    (sessionsRemaining!=null) ? sessionsRemaining : '—';
  document.getElementById('etaFinish').textContent = etaText;
}