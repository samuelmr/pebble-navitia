var ajax = require('ajax');
var Settings = require('settings');
var UI = require('ui');
var Vector2 = require('vector2');
var Vibe = require('ui/vibe');

var MAX_DEPS = 10;
var MAX_STOPS = 10;
var MAX_ROUTES = 5;
var R = 6371000; // m

// in Paris, headsigns are like "RTP:11017661970894282401988" for buses
// and "202" for metro 1, thus ignore long headsigns
var MAX_HEADSIGN_LENGTH = 18;

var apiBase = "https://api.navitia.io/v1/";
var apiKey = "d513a229-0ddd-45f0-be27-686d7fe7b6cc";
var apiHeaders = {"Authorization": apiKey};
var locationOptions = { "timeout": 15000, "maximumAge": 1000, "enableHighAccuracy": true };

var fakes = [
  {lat: 60.1993028, lon: 24.940420, addr: 'HSL', region: 'fi'},
  // {lat: 32.756324, lon: -117.090995, addr: 'El Cajon Bl & 48th St', region: 'us-ca'},
  {lat: 40.761433, lon: -73.977622, addr: 'MoMA', region: 'us-ny'},
  // {lat: 48.847002, lon: 2.377310, addr: '20, rue Hector Malot', region: 'fr-idf'}
  {lat: 48.873792, lon: 2.295028, addr: 'Arc de Triomphe', region: 'fr-idf'}
];

var demoTargets = {
  'fi': [{title: 'Helsinki Zoo', subtitle: '60.1796087,24.9827908', lat: 60.1796087, lon: 24.98279}],
  'fr-idf': [{title: 'Eiffel Tower', subtitle: '48.85837,2.294481', lat: 48.85837, lon: 2.294481}],
  'us-ca': [{title: 'Golden Gate', subtitle: '37.80826,-122.4752', lat: 37.80826, lon: -122.4752}],
  'us-ny': [{title: 'Empire State Building', subtitle: '40.74844,-73.985664', lat: 40.74844, lon: -73.985664}]
};

var tag_translate = {'no_train': 'no train',
                     'less_fallback_walk': 'less walking',
                     'less_fallback_bike': 'less biking',
                     'less_fallback_bss': 'less bike sharing',
                     'non_pt_walk': 'walk only',
                     'non_pt_bike': 'bike only',
                     'non_pt_bss': 'bike sharing only'};

var stops = [];
var timeTables = {};
var watcher;
var region = Settings.data('region');
var myLat, myLon, myAddr;

var errorItems = [{title: 'No data!', subtitle: 'Try again...'}];
var helpId = 'help';

var favorites = Settings.data('favorites') || [];
var storedLocations = Settings.data('storedLocations') || {};
var stopLocations = storedLocations;
// var targets = Settings.data('targets') || [{title: 'Add new', subtitle: 'Current location'}];
var targets = Settings.data('targets') || [];
var journeys = [];

var distfield = new UI.Text({
  position: new Vector2(0, 26),
  size: new Vector2(144, 20),
  font: 'GOTHIC_18',
  backgroundColor: 'black',
  color: 'white',
  text: '',
  textAlign: 'center',
  textOverflow: 'ellipsis'
});

var menu = new UI.Menu({
  sections: [
    {
      title: 'Favorites',
      items: favorites
    },
    {
      title: 'Nearest',
      items: []
    }
  ]
});
menu.on('select', function(e) {
  console.log('Menu called, section ' + e.sectionIndex + ', item ' + e.itemIndex);
  if (!e.item) {
    console.log('Item ' + e.itemIndex + ' not found!');
  }
  var items = timeTables[e.item.id] || errorItems;
  // menu of stop departures
  var stopMenu = new UI.Menu({
    sections: [{
      title: e.item.title,
      items: items
    }]
  });
  stopMenu.show();
  stopMenu.on('select', function(se){
    if (watcher) {
      navigator.geolocation.clearWatch(watcher);     
    }
    var data = se.item.data;
    if (!data) {
      return false;
    }
    var depTime = parseTime(data.stop_date_time, true);
    var wind = new UI.Window({fullscreen: true});
    var stopfield = new UI.Text({
      position: new Vector2(0, 10),
      size: new Vector2(144, 15),
      font: 'GOTHIC_14_BOLD',
      backgroundColor: 'black',
      color: 'white',
      text: data.stop_point.name,
      textAlign: 'center',
      textOverflow: 'ellipsis'
    });
    wind.add(stopfield);
    distfield.text(data.stop_point.address.name);
    wind.add(distfield);
    if (stopLocations[data.stop]) {
      // doesn't work very well with faked positions...
      watcher = navigator.geolocation.watchPosition(function(pos) {
        if (stopLocations && stopLocations[data.stop]) {
          var dh = disthead(pos.coords, stopLocations[data.stop]);
          var head = 'north';
          dh.heading = (dh.heading < 0) ? 360 + dh.heading : dh.heading;
          if (dh.heading < 22.5){
            head = 'north';
          }
          else if (dh.heading < 67.5){
            head = 'northeast';
          }
          else if (dh.heading < 112.5){
            head = 'east';
          }
          else if (dh.heading < 157.5){
            head = 'southeast';
          }
          else if (dh.heading < 202.5){
            head = 'south';
          }
          else if (dh.heading < 247.5){
            head = 'southwest';
          }
          else if (dh.heading < 292.5){
            head = 'west';
          }
          else if (dh.heading < 337.5){
            head = 'northwest';
          }
          distfield.text(Math.round(dh.distance) + ' m ' + head);
        }
      });
    }
    var linefield = new UI.Text({
      position: new Vector2(0, 60),
      size: new Vector2(144, 30),
      font: 'GOTHIC_24',
      backgroundColor: 'white',
      color: 'black',
      text: data.line + ' ' + data.dest,
      textAlign: 'center',
      textOverflow: 'ellipsis'
    });
    wind.add(linefield);
    var depfield = new UI.Text({
      position: new Vector2(0, 90),
      size: new Vector2(144, 30),
      font: 'BITHAM_30_BLACK',
      backgroundColor: 'white',
      color: 'black',
      text: depTime,
      textAlign: 'center',
      textOverflow: 'ellipsis'
    });
    wind.add(depfield);
    var timefield = new UI.TimeText({
      position: new Vector2(0, 120),
      size: new Vector2(144, 48),
      font: 'BITHAM_30_BLACK',
      backgroundColor: 'white',
      color: 'black',
      text: '%X',
      textAlign: 'center',
      textOverflow: 'ellipsis'
    });
    wind.add(timefield);   
    wind.show();
    wind.on('hide', function() {if (watcher) { navigator.geolocation.clearWatch(watcher);}});
  });
});
menu.on('longSelect', function(e) {
  if (e.sectionIndex > 0) {
    // console.log('Adding ' + e.item.id + ' to favorites.');
    favorites.push(e.item);
    storedLocations[e.item.id] = stopLocations[e.item.id];
    // simple but unreliable?
    // menu.items(e.sectionIndex).splice(e.itemIndex, 1);
    var itemCopy = menu.items(e.sectionIndex);
    itemCopy.splice(e.itemIndex, 1);
    menu.items(e.sectionIndex, itemCopy);
  }
  else {
    // console.log('Removing ' + e.item.id + ' from favorites.');
    e.item.subtitle = e.item.dist;
    // simple but unreliable?
    // menu.items(1, menu.items(1).push(e.item));
    var copy = menu.items(1);
    menu.items(1, copy.push(e.item));
    favorites.splice(e.itemIndex, 1);
    storedLocations[e.item.id] = null;
  }
  menu.items(0, favorites);
  for (var f in favorites) {
    favorites[f].subtitle = favorites[f].addr;
  }
  Settings.data('favorites', favorites);
  Settings.data('storedLocations', storedLocations);
});

var journeyMenu = new UI.Menu();
journeyMenu.on('select', function(e) {
  showJourneyCard(e.itemIndex); 
});

var main = new UI.Menu({
  sections: [
    {title: 'Locating...'}
  ]
});
main.on('select', function(e) {
  if (e.sectionIndex === 0) {
    if (e.itemIndex === 0) {
      // refresh location
      main.item(0, 0, {title: 'Locating...', subtitle: 'Please wait'});
      menu.section(1, {title: 'Nearest', items: [] });
      // menu.items(1, []);
      navigator.geolocation.getCurrentPosition(locationSuccess, locationError, locationOptions);
    }
    else {
      // show stops
      menu.show();
    }
  }
  else {
    // show route
    var from = myLon + ';' + myLat;
    var to = e.item.lon + ';' + e.item.lat;
    var dt = formatDateTime(new Date());
    var href = apiBase + 'journeys?from=' + from + '&to=' + to + '&datetime=' + dt + '&count=' + MAX_ROUTES;
    console.log("Getting " + href);
    ajax(
      {url: href, headers: apiHeaders, type: 'json', async: false},
      showRoute,
      showRoute // same function also handles errors
    );
  }
});
main.on('longSelect', function(e) {
  if (e.sectionIndex === 0) {
    if (e.itemIndex === 0) {
      // add target
      var copy = e.item;
      copy.subtitle = e.lat + ',' + e.lon;
      addTarget(copy);
    }
    else {
      // refresh nearby stops
      main.item(0, 1, {title: 'Fetching stops...', subtitle: 'Please wait'});
      refreshStops(favorites);
      refreshStops(stops);
    }
  }
  else {
    // remove target
    targets.splice(e.itemIndex);
    showTargets();
  }
});
showTargets();
main.show();

if (favorites.length > 0) {
  refreshStops(favorites);  
}

navigator.geolocation.getCurrentPosition(locationSuccess, locationError, locationOptions);

function showTargets() {
  if (targets && (targets.length > 0)) {
    main.section(1, {title: 'Targets', items: targets});  
  }
  else {
    main.sections(main.section(0));
  }
}

function locationError(error) {
  main.item(0, 0, {title: 'Locaion error!', subtitle: 'Try again...'});
  console.warn('location error (' + error.code + '): ' + error.message);
}

function locationSuccess(position) {
  myLat = position.coords.latitude;
  myLon = position.coords.longitude;
  console.log('Found location: ' + myLat + ',' + myLon);
  var href;
  href = apiBase + 'coord/' + myLon + ';' + myLat;
  console.log("Getting " + href);
  ajax(
    {url: href, headers: apiHeaders, type: 'json'},
    initMain,
    fakeMain
  );
}
function initMain(response) {
  console.log('Init main, got ' + response.regions.length + ' regions');
  region = response.regions[0];
  myAddr = response.address.name;
  getStops('Located');
}
function fakeMain(result) {
  if (result && result.message) {
    console.log('Got ' + result.message);
  }
  var r = Math.floor(Math.random() * fakes.length);
  console.log('Using fake location ' + (r+1) + ' of ' + fakes.length);
  var f = fakes[r];
  myLat = f.lat;
  myLon = f.lon;
  myAddr = f.addr;
  region = f.region;
  targets = demoTargets[region];
  showTargets();
  getStops('Fake address');
}
function getStops(title) {
  var myItem = {title: myAddr,
                subtitle: 'Refresh location',
                lat: myLat, lon: myLon};
  main.section(0, {title: title, items: [myItem]});
  main.item(0, 1, {title: 'Fetching stops...', subtitle: 'Please wait'});
  // ridiculous results
  // var href = apiBase + 'coverage/' + region + '/' + myLon + ';' + myLat + '/departures?count=' + MAX_STOPS;
  var href = apiBase + 'coverage/' + region + '/coords/' + myLon + ';' + myLat + '/departures?count=' + MAX_STOPS;
  console.log("Getting " + href);
  ajax(
    {url: href, headers: apiHeaders, type: 'json'},
    buildStopMenu,
    logError
  );  
}
function addTarget(item) {
  item.subtitle = 'Get route';
  targets.push(item);
  main.section(1, {title: 'Targets', items: targets});
}

function logError(e) {
  main.item(0, 1, {title: 'Error!', subtitle: 'Try again...'});
  console.warn("Error getting Ajax: " + e);
}
function buildStopMenu(response) {
  stops = [];
  if (!response || !response.departures) {
    return false;
  }
  
  resp: for (var i=0; i<response.departures.length; i++) {
    if (!response.departures[i]) {
      continue;
    }
    var id = response.departures[i].stop_point.id;
    for (var j=0; j<favorites.length; j++) {
      if (id == favorites[j].id) {
        continue resp;
      }
    }
    var coords = response.departures[i].stop_point.coord;
    stopLocations[id] = {latitude: coords.lat, longitude: coords.lon};
    var name = response.departures[i].stop_point.name;
    // PebbleJS has a length bug
    name = name.replace(/[åäáà]/g, 'a');
    name = name.replace(/[éè]/g, 'e');
    name = name.replace(/[ö]/g, 'o');
    name = name.replace(/[ÅÁÀÄ]/g, 'A');
    name = name.replace(/[ÉÈ]/g, 'E');
    name = name.replace(/[Ö]/g, 'O');
    var dist = response.departures[i].stop_point.distance || ''; // not found!
    var addr = getAddress(response.departures[i]);
/*
    var addr;
    if (response.departures[i].address) {
      // number before name for US or just use label?
      addr = response.departures[i].stop_point.address.name + ' ' +
             response.departures[i].stop_point.address.house_number;
    }
*/
    console.log("got stop: " + id + ", name " + name + ", dist " + dist);
    if (!id || !name) {
      console.log("Information missing, skipping stop...");
      continue;
    }
    var line = response.departures[i].route.line.code ||
               response.departures[i].route.line.name;
    var depTime = parseTime(response.departures[i].stop_date_time);
    var nextDep = depTime + ' ' + line;
                 
/*
    if (dist > 999) {
      dist = Math.round(dist/100)/10 + " km";
    }
    else {
      dist = dist + " m";
    }
*/
    stops.push({id: id, addr: addr, dist: dist, region: region, title: name, subtitle: nextDep});
  }
  menu.items(1, stops);
  if (stops.length < 1) {
    return false;
  }
  if (menu.items(0).length < 1) {
    menu.items(0, [{id: helpId, title: 'No favorites', subtitle: 'Instructions...'}]);
  }
  // menu.show();
  refreshStops(stops);
}
function refreshStops(stops) {
  console.log('Refreshing ' + stops.length + ' stops...');
  if (stops.length <= 0) {
    return false;
  }
  for (var i=0; i<stops.length; i++) {
    var href = apiBase + 'coverage/' + stops[i].region + '/stop_points/' + 
               stops[i].id + '/departures?count=' + MAX_DEPS;
    console.log('Getting stop' + i + ': ' + href);
    ajax(
      {url: href, headers: apiHeaders, type: 'json'},
      addToTimeTables,
      logError
    );
  }
  main.item(0, 1, {title: stops.length + ' stops nearby', subtitle: 'Show timetables'});
}
function addToTimeTables(data) {
  var deps = data.departures;
  if (deps.length) {
    timeTables[helpId] = [{title: 'Long press', subtitle: 'to add favorite'}];
    for (var j=0; j<deps.length; j++) {
      var dep = deps[j];
      var stopId = dep.stop_point.id;
      if (!timeTables[stopId]) {
        timeTables[stopId] = [];
      }
      dep.line = dep.route.line.code ||
                 dep.route.line.name;
      dep.time = parseTime(dep.stop_date_time, false);
      dep.dest = dep.route.direction.stop_point.name ||
                 dep.route.direction.name ||
                 dep.route.name;
      timeTables[stopId].push({title: dep.time + ' ' + dep.line,
                               subtitle: dep.dest, data: dep});
    }
    for (var sect=0; sect<=1; sect++) {
      for (var it in menu.items(sect)) {
        var current = menu.item(sect, it);
        // console.log('Found item' + current.title);
        if (!current.id || !timeTables[current.id] || (current.id == helpId)) {
          continue;
        }
        var magicSub = (sect == 1) ? current.dist + '   ' : '';
        var nextDeps = [];
        for (var n=0; n<(2-sect); n++) {
          nextDeps.push(timeTables[current.id][n].title);
        }
        magicSub += nextDeps.join(', ');
        var newItem = {id: current.id, title: current.title,
                       subtitle: magicSub};
        menu.item(sect, it, newItem);
      }
    }
  }
}
function showRoute(response) {
  journeys = response.journeys;
  if (journeys && (journeys.length > 1)) {
    console.log(journeys.length + ' journeys');
    var items = [];
    for (var i=0; i<journeys.length; i++) {
      var depTime = parseTime(journeys[i]);
      var depPlace = getAddress(journeys[i].sections[0].from);
      var duration = Math.round(journeys[i].duration/60) + ' minutes';
      var tag = journeys[i].type;
      if (tag && tag_translate[tag]) {
        tag = tag_translate[tag];
      }
      var subtitle = duration + (tag ? ', ' + tag : '');
      items.push({title: depTime + ' ' + depPlace, 
                  subtitle: subtitle});
    }
    journeyMenu.section(0, {title: journeys.length + ' choices', items: items});
    journeyMenu.show();
  }
  else if (journeys && (journeys.length > 0)) {
    showJourneyCard(0);
  }
  else {
    // show error card?
    console.log('Routing not possible');
    var errMsg = 'No routes available from your current position at the moment. Sorry!';
    if (response.error && response.error.message) {
      errMsg = response.error.message;
    }
    var card = new UI.Card({
      title: 'Routing error',
      body: errMsg,
      scrollable: true
    });
    card.show();
  }
}
function showJourneyCard(index) {
  var j = journeys[index];
  var c = '';
  var alerts = [];
  for (var i=0; i<j.sections.length; i++) {
    var s = j.sections[i];
    var m = getType(s);
    var d = parseTime(s);
    var dur = getDuration(s);
    // var f = getAddress(s.from);
    var t = getAddress(s.to);
    switch(m) {
      case 'Wait': 
        c += d + ' ' + m +
        (dur ? ' ' + dur : '');
        break;
      case 'Walk': 
        c += d + ' ' + m +
        (dur ? ' ' + dur : '') + 
        (t ? ' to ' + t : '');
        break;
      default:
        if (!t) {
          continue;
        }
        c += d + ' ' + m + 
          (t ? ' to ' + t : '');
    }
    c += ((c[c.length] != '.') ? '.' : '')+ '\n\n';
    alerts.push(setAlert(s.departure_date_time));
  }
  var card = new UI.Card({
    title: 'Instructions',
    body: c,
    scrollable: true
  });
  card.show();
  card.on('hide', function() {
    for (var i=0; i<alerts.length; i++) {
      if (alerts[i]) {
        clearTimeout(alerts[i]);      
      }
    }
  });
}
function getAddress(obj) {
  if(!obj) {
    return false;
  }
  var o = obj; // local copy
  if (o.embedded_type && (o.embedded_type == 'stop_point') && o.stop_point) {
    if (o.stop_point.name) {
      return o.stop_point.name;
    }
    o = o.stop_point;
  }
  else if (o.embedded_type && o[o.embedded_type]) {
    o = o[o.embedded_type];
  }
  if (o.address) {
    var n = o.address.house_number;
    var a = o.address.name + (n ? ' ' + n : '');
    if (a) {
      return a;
    }
  }
  if (o.coords) {
    return Math.round(1000 * o.coords.lat)/1000 + ',' + 
           Math.round(1000 * o.coords.lon)/1000;
  }
  return '';
}
function getType(obj) {
  var mode;
  if (obj.display_informations) {
    if (obj.display_informations.physical_mode) {
      mode = obj.display_informations.physical_mode;
    }
    else if (obj.display_informations.commercial_mode) {
      mode = obj.display_informations.commercial_mode;    
    }
    if (obj.display_informations.code) {
      mode += ' ' + obj.display_informations.code;
    }
    if (obj.display_informations.headsign &&
       (obj.display_informations.headsign.length < MAX_HEADSIGN_LENGTH)) {
      mode += ' "' + obj.display_informations.headsign + '"';
    }
    else if (obj.display_informations.label && 
        (obj.display_informations.label != obj.display_informations.code)) {
      mode += ' "' + obj.display_informations.label + '"';
    }
  }
  else if (obj.mode) {
    mode = obj.mode;
  }
  else if (obj.transfer_type) {
    mode = obj.transfer_type;
  }
  else if (obj.type) {
    mode = obj.type;
  }
  if (!mode || !mode.toLowerCase) {
    return '';
  }
  switch (mode) {
    case 'walking':
      return 'Walk';
    case 'biking':
      return 'Bike';
    case 'car':
      return 'Drive';
    case 'waiting':
      return 'Wait';
    case 'guaranteed':
      return 'Guaranteed transfer';
    case 'extension':
      return 'Extended transfer';
    case 'stay_in':
      return 'Stay in the ' + mode.toLowerCase();
    default:
      return 'Take the ' + mode.toLowerCase();
  }
}
function getDuration(obj) {
  if (!obj || !obj.duration) {
    return false;
  }
  var mins = Math.round(obj.duration/60);
  return mins + ' minute' + ((mins != 1) ? 's' : '');
}
function disthead(pos1, pos2) {
  var dLat = toRad(pos2.latitude-pos1.latitude);
  var dLon = toRad(pos2.longitude-pos1.longitude);
  // return ({distance: dLat, heading: dLon}); 
  var l1 = toRad(pos1.latitude);
  var l2 = toRad(pos2.latitude);
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(l1) * Math.cos(l2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var dist = Math.round(R * c);
  var y = Math.sin(dLon) * Math.cos(l2);
  var x = Math.cos(l1)*Math.sin(l2) -
          Math.sin(l1)*Math.cos(l2)*Math.cos(dLon);
  var head = toDeg(Math.round(Math.atan2(y, x)));
  return ({distance: dist, heading: head});
}
function parseTime(obj, longFormat) {
  var dt = obj.departure_date_time;
  var d = strToTime(dt);
  var h = d.getHours();
  if (longFormat) {
    h = (h < 10) ? '0' + h : h;
  }
  var m = d.getMinutes();
  var s = d.getSeconds();
  var str = h + ':' + ((m < 10) ? '0' + m : m);
  if (longFormat || s) {
    str += ':' + ((s < 10) ? '0' + s : s);
  }  
  return  str;  
/*
  var match = dt.match(/T(\d{2})(\d{2})(\d{2})$/);
  var resp = '';
  if (match) {
    var h = match[1].replace(/^0/, '');
    var m = match[2];
    var s = match[3];
    resp = '' + h + ':' + m;
    if (secs) {
      resp += ':' + s;
    }
  }
  return resp;
*/
}
function strToTime(str) {
  var y = str.substr(0,4);
  var m = str.substr(4,2)-1;
  var d = str.substr(6,2);
  var h = str.substr(9,2);
  var i = str.substr(11,2);
  var s = str.substr(13,2);
  return new Date(y, m, d, h, i, s);
}
function formatDateTime(d) {
  return d.getFullYear() +
    ((d.getMonth() < 9) ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1)) +
    ((d.getDate() < 10) ? '0' + d.getDate() : d.getDate()) +
    'T' +
    ((d.getHours() < 10) ? '0' + d.getHours() : d.getHours()) +
    ((d.getMinutes() < 10) ? '0' + d.getMinutes() : d.getMinutes()) +
    ((d.getSeconds() < 10) ? '0' + d.getSeconds() : d.getSeconds());
}
function setAlert(str) {
  if (!str) {
    console.log('No alert, empty str');
    return false;
  }
  var then = strToTime(str);
  var now = new Date();
  // console.log('Now is ' + now.toString() + ', then is ' + then.toString());
  var diff = then - now;
  // console.log(diff + ' ms until ' + str);
  return setTimeout(function () { Vibe.vibrate('long');}, diff);
}
function toRad(num) {
  return num * Math.PI / 180;  
}
function toDeg(num) {
  return num * 180 / Math.PI;
}

