define([ "message-bus", "layout", "jquery", "openlayers" ], function(bus, layout, $) {

	/*
	 * keep the information about wms layers that will be necessary for
	 * visibility, opacity, etc.
	 */
	var mapLayersByLayerId = {};

	/*
	 * Stores the indices during the layer load in order to set the right order
	 * when all layers are in the map
	 */
	var zIndexes = {};

	var map = null;
	var currentControlList = [];
	var defaultExclusiveControl = null;

	var activateExclusiveControl = function(controlList) {
		for (var i = 0; i < currentControlList.length; i++) {
			currentControlList[i].deactivate();
			map.removeControl(currentControlList[i]);
		}

		for (var i = 0; i < controlList.length; i++) {
			map.addControl(controlList[i]);
			controlList[i].activate();
		}

		currentControlList = controlList;
	};

	OpenLayers.ProxyHost = "proxy?url=";

	map = new OpenLayers.Map(layout.map.attr("id"), {
		fallThrough : true,
		theme : null,
		projection : new OpenLayers.Projection("EPSG:900913"),
		displayProjection : new OpenLayers.Projection("EPSG:4326"),
		units : "m",
		allOverlays : true,
		controls : []
	});
	map.addControl(new OpenLayers.Control.Navigation());
	map.addControl(new OpenLayers.Control.Scale());

	bus.listen("add-layer", function(event, layerInfo) {
		var mapLayerArray = [];
		$.each(layerInfo.wmsLayers, function(index, wmsLayer) {
			var layer;
			if (wmsLayer.type == "osm") {
				layer = new OpenLayers.Layer.OSM(wmsLayer.id, wmsLayer.osmUrls);
			} else if (wmsLayer.type == "gmaps") {
				layer = new OpenLayers.Layer.Google(wmsLayer.id, {
					type : google.maps.MapTypeId[wmsLayer["gmaps-type"]]
				});
			} else if (wmsLayer.type == "wfs") {
				layer = new OpenLayers.Layer.Vector("WFS", {
					strategies : [ new OpenLayers.Strategy.Fixed() ],
					protocol : new OpenLayers.Protocol.WFS({
						version : "1.0.0",
						url : wmsLayer.baseUrl,
						featureType : wmsLayer.featureTypeName
					}),
					projection : new OpenLayers.Projection("EPSG:4326")
				});
			} else {
				layer = new OpenLayers.Layer.WMS(wmsLayer.id, wmsLayer.baseUrl, {
					layers : wmsLayer.wmsName,
					buffer : 0,
					transitionEffect : "resize",
					removeBackBufferDelay : 0,
					isBaseLayer : false,
					transparent : true,
					format : wmsLayer.imageFormat || 'image/png'
				}, {
					noMagic : true,
					visibility: false // Don't show until a "layer-visibility" event indicates so
				});
			}
			layer.id = wmsLayer.id;
			if (map !== null) {
				map.addLayer(layer);
				map.setLayerIndex(layer, wmsLayer.zIndex);
				zIndexes[wmsLayer.id] = wmsLayer.zIndex;
			}
			mapLayerArray.push(wmsLayer.id);
		});
		if (mapLayerArray.length > 0) {
			mapLayersByLayerId[layerInfo.id] = mapLayerArray;
		}
	});

	bus.listen("reset-layers", function() {
		zIndexes = {};
		mapLayersByLayerId = {};
		if (map !== null) {
			for (var i in map.layers) {
				map.removeLayer(map.layers[i]);
			}
		}
	});

	var sortLayers = function() {
		/*
		 * Sort all layers by zIndexes
		 */
		var sorted = Object.keys(zIndexes).sort(function(a, b) {
			return zIndexes[a] - zIndexes[b]
		});

		for (var i = 0; i < sorted.length; i++) {
			var id = sorted[i];
			var z = zIndexes[id];
			var layer = map.getLayer(id);
			if (layer) {
				map.setLayerIndex(layer, z);
			}
		}
	}

	var addVectorLayer = function() {
		var id = "Highlighted Features";

		// Remove if exists
		var vector = map.getLayer(id);
		if (map !== null && vector) {
			map.removeLayer(vector);
		}

		// Create new vector layer
		vector = new OpenLayers.Layer.Vector(id, {
			styleMap: new OpenLayers.StyleMap({
				'strokeWidth' : 5,
				fillOpacity : 0,
				strokeColor : '#ee4400',
				strokeOpacity : 0.5,
				strokeLinecap : 'round'
			})
		});
		vector.id = id;
		map.addLayer(vector);
	}

	bus.listen("layers-loaded", function() {
		sortLayers();
		addVectorLayer();
	});

	bus.listen("layer-visibility", function(event, layerId, visibility) {
		var mapLayers = mapLayersByLayerId[layerId];
		if (mapLayers) {
			$.each(mapLayers, function(index, mapLayerId) {
				var layer = map.getLayer(mapLayerId);
				layer.setVisibility(visibility);
			});
		}
	});

	bus.listen("activate-exclusive-control", function(event, control) {
		if (!control) {
			control = [];
		} else if (!$.isArray(control)) {
			control = [ control ];
		}
		activateExclusiveControl(control);
	});

	bus.listen("activate-default-exclusive-control", function(event) {
		activateExclusiveControl(defaultExclusiveControl);
	});

	bus.listen("set-default-exclusive-control", function(event, control) {
		if (!control) {
			control = [];
		} else if (!$.isArray(control)) {
			control = [ control ];
		}
		defaultExclusiveControl = control;
	});

	bus.listen("layer-timestamp-selected", function(event, layerId, timestamp, style) {
		var mapLayers = mapLayersByLayerId[layerId];
		if (mapLayers) {
			$.each(mapLayers, function(index, mapLayerId) {
				var layer = map.getLayer(mapLayerId);
				/*
				 * On application startup some events can be produced before the
				 * map has the reference to the layers so we have to check if
				 * layer is null
				 */
				if (layer !== null && timestamp !== null) {
					var newParams = {
						'time' : timestamp.toISO8601String()
					};
					if (style != null) {
						newParams["styles"] = style;
					}
					layer.mergeNewParams(newParams);
				}
			});
		}
	});

	bus.listen("zoom-in", function(event) {
		map.zoomIn();
	});

	bus.listen("zoom-out", function(event) {
		map.zoomOut();
	});

	bus.listen("zoom-to", function(event, bounds) {
		map.zoomToExtent(bounds);
	});

	bus.listen("transparency-slider-changed", function(event, layerId, opacity) {
		var mapLayers = mapLayersByLayerId[layerId];
		if (mapLayers) {
			$.each(mapLayers, function(index, mapLayerId) {
				var layer = map.getLayer(mapLayerId);
				layer.setOpacity(opacity);
			});
		}
	});

	/*
	 * To simulate clicks. Used at least in the tour
	 */
	bus.listen("map-click", function(event, lat, lon) {
		var mapPoint = new OpenLayers.LonLat(lon, lat);
		mapPoint.transform(new OpenLayers.Projection("EPSG:4326"), map.projection);
		map.events.triggerEvent("click", {
			xy : map.getPixelFromLonLat(mapPoint)
		});
	});

	return map;
});