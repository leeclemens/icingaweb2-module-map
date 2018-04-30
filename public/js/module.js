(function (Icinga) {

    function colorMarker(worstState, icon) {
        var markerColor = 'awesome-marker';

        // TODO: Different marker icon for not-OK states
        // if(worstState > 0) {
        //     markerColor = markerColor + ' awesome-marker-square';
        // }

        var marker = L.AwesomeMarkers.icon({
            icon: icon,
            markerColor: state2color(worstState),
            className: markerColor
        });

        return marker
    }

    function state2color(state) {
        switch (parseInt(state)) {
            case 0:
                return "green";
            case 1:
                return "lightgreen";
            case 2:
                return "lightred";
            case 3:
                return "pink";
            case 31:
                return "orange";
            case 32:
                return "red";
            case 33:
                return "violet";
            case 61:
                return "darkred";
            case 63:
                return "violet";
            default:
                return "blue";
        }
    }

    function isFilterParameter(parameter) {
        return (parameter.charAt(0) === '(' || parameter.match('^[_]{0,1}(host|service)') || parameter.match('^(object|state)Type'));
    }

    function getParameters(id) {
        var params = decodeURIComponent($('#map-' + id).closest('.module-map').data('icingaUrl')).split('&');

        // remove module path from url parameters
        if (params.length > 0) {
            params[0] = params[0].replace(/^.*\?/, '')
        }

        return params
    }

    function unique(list) {
        var result = [];
        $.each(list, function (i, e) {
            if ($.inArray(e, result) === -1) result.push(e);
        });
        return result;
    }

    function filterParams(id, extra) {
        var sURLVariables = getParameters(id);
        var params = [],
            i;

        if (extra !== undefined) {
            sURLVariables = $.merge(extra.split('&'), sURLVariables);
            sURLVariables = unique(sURLVariables);
        }

        for (i = 0; i < sURLVariables.length; i++) {
            // Protect Icinga filter syntax
            if (isFilterParameter(sURLVariables[i])) {
                params.push(sURLVariables[i]);
                continue;
            }
        }

        return params.join("&")
    }

    function showDefaultView() {
        if (map_default_lat !== null && map_default_long !== null) {
            if (map_default_zoom !== null) {
                cache[id].map.setView([map_default_lat, map_default_long], map_default_zoom);
            } else {
                cache[id].map.setView([map_default_lat, map_default_long]);
            }
        } else {
            cache[id].map.fitWorld()
        }
    }

    function toggleFullscreen() {
        icinga.ui.toggleFullscreen();
        cache[id].map.invalidateSize();
        cache[id].fullscreen = !cache[id].fullscreen;
        if (cache[id].fullscreen) {
            $('.controls').hide();
        } else {
            $('.controls').show();
        }
    }

    // TODO: Allow update of multiple parameters
    function updateUrl(pkey, pvalue) {
        // Don't update URL if in dashlet mode
        if (dashlet) {
            return;
        }

        var $target = $('.module-map');
        var $currentUrl = $target.data('icingaUrl');
        var basePath = $currentUrl.replace(/\?.*$/, '');
        var searchPath = $currentUrl.replace(/^.*\?/, '');

        var sURLVariables = (searchPath === basePath ? [] : searchPath.split('&'));

        var updated = false;
        for (var i = 0; i < sURLVariables.length; i++) {
            // Don't replace Icinga filters
            if (isFilterParameter(sURLVariables[i])) {
                continue;
            }

            var tmp = sURLVariables[i].split('=');
            if (tmp[0] === pkey) {
                sURLVariables[i] = tmp[0] + '=' + pvalue;
                updated = true;
                break;
            }
        }

        // Parameter is to be added
        if (!updated) {
            sURLVariables.push(pkey + "=" + pvalue);
        }

        $target.data('icingaUrl', basePath + '?' + sURLVariables.join('&'));
        icinga.history.pushCurrentState();
    }

    function getWorstState(states) {
        var worstState = -1;
        for (var i = 0, len = states.length; i < len; i++) {
            var state = states[i];
            if (state > worstState) {
                worstState = state
            }
        }
        return worstState;
    }

    function mapCenter(hostname) {
        if (cache[id].hostMarkers[hostname]) {
            var el = cache[id].hostMarkers[hostname];
            cache[id].map.panTo(cache[id].hostMarkers[hostname].getLatLng())
        }
    }

    var cache = {};

    var Map = function (module) {
        this.module = module;
        this.initialize();
        this.timer;
        this.module.icinga.logger.debug('Map module loaded');
    };

    Map.prototype = {

        initialize: function () {
            this.timer = {};
            this.module.on('rendered', this.onRenderedContainer);
            this.registerTimer()
        },

        registerTimer: function (id) {
            this.timer = this.module.icinga.timer.register(
                this.updateAllMapData,
                this,
                10000
            );
            return this;
        },

        removeTimer: function (id) {
            this.module.icinga.timer.unregister(this.timer);
            return this
        },

        onPopupOpen: function (evt) {
            $('.detail-link').on("click", function (ievt) {
                mapCenter(evt.popup._source.options.id);
                cache[id].map.invalidateSize();
            });
        },

        updateAllMapData: function () {
            var _this = this;

            if (cache.length === 0) {
                this.removeTimer(id);
                return this
            }

            $.each(cache, function (id) {
                if (!$('#map-' + id).length) {
                    delete cache[id]
                } else {
                    _this.updateMapData({id: id})
                }
            });
        },

        updateMapData: function (parameters) {
            var id = parameters.id;
            var show_host = parameters.show_host;
            var $that = this;

            function showHost(hostname) {
                if (cache[id].hostMarkers[hostname]) {
                    var el = cache[id].hostMarkers[hostname];
                    cache[id].markers.zoomToShowLayer(el, function () {
                        el.openPopup();
                    })
                }
            }

            function removeOldMarkers(id, data) {
                // remove old markers
                $.each(cache[id].hostMarkers, function (identifier, d) {
                    if ((data['hosts'] && !data['hosts'][identifier]) && (data['services'] && !data['services'][identifier])) {
                        cache[id].markers.removeLayer(d);
                        delete cache[id].hostMarkers[identifier];
                    }
                });
            }

            function errorMessage(msg) {
                cache[id].map.spin(false);
                $map = cache[id].map;
                $map.openModal({
                    content: "<p>Could not fetch data from API:</p><pre>" + msg + "</pre>",
                    onShow: function (evt) {
                        $that.removeTimer(id)
                    },
                    onHide: function (evt) {
                        $that.registerTimer(id);
                    }
                });
            }

            function processData(json) {
                if (json['message']) {
                    errorMessage(json['message']);
                    return;
                }
                removeOldMarkers(id, json);

                $.each(json, function (type, element) {
                    $.each(element, function (identifier, data) {
                        if (data.length < 1 || data['coordinates'] === "") {
                            console.log('found empty coordinates: ' + data);
                            return true
                        }

                        var states = [];
                        var icon;
                        var services;
                        var worstState;
                        var display_name = (data['host_display_name'] ? data['host_display_name'] : hostname);

                        if (type === 'hosts') {
                            var host_state = parseInt(data['host_state']);
                            states.push(host_state === 0 || parseInt(data['host_acknowledged']) === 1 || parseInt(data['host_in_downtime']) === 1 ? host_state : host_state + 60);
                        }

                        services = '<div class="map-popup-services">';
                        services += '<h1><span class="icon-services"></span> Services</h1>';
                        services += '<div class="scroll-view">';
                        services += '<table class="icinga-module module-monitoring">';
                        services += '<tbody>';

                        $.each(data['services'], function (service_display_name, service) {
                            var service_state = parseInt(service['service_state']);
                            //console.log('service: ' + service['service_state']);
                            //states.push(service['service_state'])
                            //console.log('service_acknowledged: ' + service['service_acknowledged']);
                            states.push(service_state === 0 || service_state === 99 || parseInt(service['service_acknowledged']) === 1 || parseInt(service['service_in_downtime']) === 1 ? service_state : service_state + 30);
                            if (service_state !== 0) {
                                console.log('  state: ' + service_state);
                            }
                            //console.log('   states: ' + states);

                            services += '<tr>';

                            services += '<td class="';
                            services += "state-col";
                            services += " state-" + service_status[service['service_state']][1].toLowerCase();
                            services += "" + (parseInt(service['service_acknowledged']) === 1 || parseInt(service['service_in_downtime']) === 1 ? " handled" : "");
                            services += '">';
                            services += '<div class="state-label">';
                            services += service_status[service['service_state']][0];
                            services += '</div>';
                            services += '</td>';

                            services += '<td>';
                            services += '<div class="state-header">';
                            services += '<a data-hostname="' + data['host_name'] + '" data-base-target="_next" href="'
                                + icinga.config.baseUrl
                                + '/monitoring/service/show?host='
                                + data['host_name']
                                + '&service='
                                + service['service_name']
                                + '">';
                            services += service_display_name;
                            services += '</a>';
                            services += '</div>';
                            services += '</td>';

                            services += '</tr>';

                            if (type === 'services') {
                                display_name = service_display_name + " (" + display_name + ")";
                            }
                        });

                        services += '</tbody>';
                        services += '</table>';
                        services += '</div>';
                        services += '</div>';

                        worstState = getWorstState(states);

                        var marker_icon = (type === 'hosts' ? 'host' : 'service');
                        if (data['icon']) {
                            marker_icon = data['icon'];
                        }

                        icon = colorMarker(worstState, marker_icon);

                        var host_icon = "";
                        if (data['host_icon_image'] !== "") {
                            host_icon = '<img src="' + icinga.config.baseUrl + '/img/icons/'
                                + data['host_icon_image']
                                + '"'
                                + ((data['host_icon_image_alt'] !== "") ? ' alt="' + data['host_icon_image_alt'] + '"' : '')
                                + ' class="host-icon-image icon">';
                        }

                        var info = '<div class="map-popup">';
                        info += '<h1>';
                        info += '<a class="detail-link" data-hostname="' + data['host_name'] + '" data-base-target="_next" href="'
                            + icinga.config.baseUrl
                            + '/monitoring/host/show?host='
                            + data['host_name']
                            + '">';
                        info += ' <span class="icon-eye"></span> ';
                        info += '</a>';
                        info += data['host_display_name'] + '</h1>';

                        info += services;
                        info += '</div>';

                        var marker;

                        if (cache[id].hostMarkers[identifier]) {
                            marker = cache[id].hostMarkers[identifier];
                            marker.options.state = worstState;
                            marker.setIcon(icon);
                        } else {
                            marker = L.marker(data['coordinates'],
                                {
                                    icon: icon,
                                    title: display_name,
                                    riseOnHover: true,
                                    id: identifier,
                                    state: worstState,
                                }).addTo(cache[id].markers);

                            cache[id].hostMarkers[identifier] = marker;
                            cache[id].hostData[identifier] = data
                        }

                        marker.bindPopup(info);
                    })
                });

                cache[id].markers.refreshClusters();
                cache[id].map.spin(false);

                // TODO: Should be updated instant and not only on data refresh
                cache[id].map.invalidateSize();

                if (show_host !== "") {
                    showHost(show_host);
                    show_host = ""
                }
            }

            var url = icinga.config.baseUrl + '/map/data/points?' + filterParams(id, cache[id].parameters);
            $.getJSON(url, processData)
                .fail(function (jqxhr, textStatus, error) {
                    errorMessage(error);
                });
        },

        onRenderedContainer: function (event) {
            // in module configuration we don't have a map, so return peacefully
            if (typeof id === 'undefined') {
                return;
            }

            cache[id] = {};
            cache[id].map = L.map('map-' + id, {
                    zoomControl: false,
                    worldCopyJump: true
                }
            );

            var osm = L.tileLayer('//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                subdomains: ['a', 'b', 'c'],
                maxZoom: map_max_zoom,
                minZoom: map_min_zoom
            });
            osm.addTo(cache[id].map);

            cache[id].markers = new L.MarkerClusterGroup({
                iconCreateFunction: function (cluster) {
                    var childCount = cluster.getChildCount();

                    var states = [];
                    $.each(cluster.getAllChildMarkers(), function (id, el) {
                        states.push(el.options.state);
                    });

                    var worstState = getWorstState(states);
                    var c = ' marker-cluster-' + worstState;

                    return new L.DivIcon({
                        html: '<div><span>' + childCount + '</span></div>',
                        className: 'marker-cluster' + c,
                        iconSize: new L.Point(40, 40)
                    });
                },
                maxClusterRadius: function (zoom) {
                    return (zoom <= map_max_zoom - 1) ? 80 : 1; // radius in pixels
                }
            });

            cache[id].hostMarkers = {};
            cache[id].hostData = {};

            cache[id].fullscreen = false;
            cache[id].parameters = url_parameters;

            // TODO: fixme
            // var basePath = $currentUrl.replace(/\?.*$/, '');
            // var initialUrl = icinga.
            // $('#map-' + id).closest('.module-map').data('icingaUrl', url_parameters);

            showDefaultView();

            cache[id].map.on('popupopen', this.onPopupOpen);

            L.control.zoom({
                    zoomInTitle: translation['btn-zoom-in'],
                    zoomOutTitle: translation['btn-zoom-in']
                }
            ).addTo(cache[id].map);

            if (!dashlet) {
                L.easyButton({
                    states: [{
                        icon: 'icon-dashboard', title: translation['btn-dashboard'], onClick: function (btn, map) {
                            var dashletUri = "map" + window.location.search;
                            var uri = icinga.config.baseUrl + "/" + "dashboard/new-dashlet?url=" + encodeURIComponent(dashletUri);

                            window.open(uri, "_self")
                        }
                    }]
                }).addTo(cache[id].map);

                L.easyButton({
                    states: [{
                        icon: 'icon-resize-full-alt',
                        title: translation['btn-fullscreen'],
                        onClick: function (btn, map) {
                            toggleFullscreen();
                        }
                    }]
                }).addTo(cache[id].map);

                L.easyButton({
                    states: [{
                        icon: 'icon-globe', title: translation['btn-default'], onClick: function (btn, map) {
                            showDefaultView();
                        }
                    }]
                }).addTo(cache[id].map);


                L.control.locate({
                    icon: 'icon-pin',
                    strings: {title: translation['btn-locate']}
                }).addTo(cache[id].map);

                cache[id].map.on('map-container-resize', function () {
                    map.invalidateSize();
                    console.log("Resize")
                });

                cache[id].map.on('moveend', function (e) {
                    var center = cache[id].map.getCenter();

                    var lat = center.lat;
                    var lng = center.lng;

                    updateUrl('default_lat', lat);
                    updateUrl('default_long', lng)
                });

                cache[id].map.on('zoomend', function (e) {
                    var zoomLevel = cache[id].map.getZoom();
                    updateUrl('default_zoom', zoomLevel)
                });

                cache[id].map.on('click', function (e) {
                    // only for debugging needed
                    // var id = e.target._container.id.replace('map-', '');

                    if (e.originalEvent.ctrlKey) {
                        var coord = 'vars.geolocation = "'
                            + e.latlng.lat.toFixed(6)
                            + ','
                            + e.latlng.lng.toFixed(6)
                            + '"';

                        var popup = "<h1>Location selected</h1>"
                            + "<p>To use this location with your host(s) or service(s), just add the following config to your object definition:</p>"
                            + "<pre>" + coord + "</pre>";

                        var marker;
                        marker = L.marker(e.latlng, {icon: colorMarker(99, 'globe')});
                        marker.bindPopup(popup);
                        marker.addTo(cache[id].markers);

                        marker.on('popupclose', function (evt) {
                            cache[id].markers.removeLayer(marker);
                        });

                        cache[id].markers.zoomToShowLayer(marker, function () {
                            marker.openPopup();
                        })
                    }
                });
            }

            cache[id].markers.addTo(cache[id].map);

            cache[id].map.spin(true);
            this.updateMapData({id: id, show_host: map_show_host})

        }
    };

    Icinga.availableModules.map = Map;

}(Icinga));
