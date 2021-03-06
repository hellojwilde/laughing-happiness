App = Ember.Application.create({
	ready: function () {
		// Send our current geolocation status every two minutes.
		setInterval(function () {
			App.API.sendStatus();
		}, 1000 * 60 * 2);
	}
});

App.Store = {
	_timeline: Ember.A(),
	_jobs: Ember.A(),

	timeline: function () {
		return this._timeline;
	},

	appendToTimeline: function (appendage) {
		this._timeline.pushObject(appendage);
	}
};

App.API = {
	disambiguatePerson: function (person, callbackFn) {
		// TODO
		var options = [
			{ first_name: "Mary",
			  last_name: "Jones"},
			{ first_name: "Mary",
		    last_name: "James"}
		];
		callbackFn(options);
	},

	sendStatus: function (callbackFn) {

	},

	getJobs: function (callbackFn) {
		var jobs = [];
		callbackFn(jobs);
	},

	createJob: function (job, callbackFn) {
		callbackFn();
	}
}

App.Disambiguator = {
	_filler: null,
	fill: function (input) {
		if (this._filler) this._filler(input);
	},

	time: function (ambig, completeFn) {
		ambig.to = Date.parse(ambig.to);
		completeFn(ambig);
	},

	location: function (ambig, completeFn) {
		if (ambig.to == "here") {
			if (!navigator.geolocation) {
				App.Store.appendToTimeline({
					"type": "error",
					"text": "I'm not able to figure out where 'here' is."
				});
				return;
			}

			navigator.geolocation.getCurrentPosition(function(position) {
	      ambig.lat = position.coords.latitude;
	      ambig.lon = position.coords.longitude;
	      completeFn(ambig);
	    });
		} else {
			// TODO
		}
	},

	send: function (ambig, completeFn) {
		var _options = function(options) {
			App.Store.appendToTimeline({
	  		type: "question",
	  		what: "person",
	  		ambiguous: ambig.recipient,
	  		options: Ember.A(options)
			});

			this._filler = function (input) {
				var cmp = options.map(function (e) { 
					return e.first_name.toLowerCase() + " " + e.last_name.toLowerCase(); 
				});
				console.log(cmp);
				var idx = cmp.indexOf(input.toLowerCase());
				if (idx == -1) {
					App.Store.appendToTimeline({
						"type": "error",
						"text": "Sorry, I don't understand '" + input + "'."
					});
				} else {
					ambig.recipient = options[idx];
					completeFn(ambig);
				}
			}
		}.bind(this);

		App.API.disambiguatePerson(ambig.recipient, _options);
	}
};

App.NLP = {
	parse: function (input) {
		var psr = new Parser();
		var words = new Lexer().lex(input);
		var tagged = psr.tagConditional(psr.tagDates(new POSTagger().tag(words)));
		return psr.parse(tagged);
	},

	startDisambiguation: function (ambig, completeFn, indexCtrl) {
		function _clarifyAction() {
			indexCtrl.startThinking();
			App.Disambiguator[ambig.action.verb](ambig.action,
				function (unambig) {
					ambig.action = unambig;
					completeFn(ambig);
				});
		}

		function _clarifyCond() {
			indexCtrl.startThinking();
			App.Disambiguator[ambig.condition.type](ambig.condition, 
				function (unambig) {
					ambig.condition = unambig;
					_clarifyAction();
				});
		}

		if (ambig.condition) {
			_clarifyCond();
		} else {
			_clarifyAction();
		}
	},

	fillDisambiguation: function (input) {
		App.Disambiguator.fill(input);
	},

	endDisambiguation: function () {
		App.Disambiguator._fill = null;
	}
};

App.IndexRoute = Ember.Route.extend({
  model: function() {
    return App.Store.timeline();
  }
});

App.IndexController = Ember.ArrayController.extend(Ember.Evented, {
	itemController: 'event',
	input: "",

	isDisambiguating: false,
	isThinking: false,

	startThinking: function () { this.set("isThinking", true); },
	shouldClearThinking: Ember.observer(function () {
		this.set("isThinking", false);
	}, "content.@each"),

	shouldScrollToBottom: Ember.observer(function () {
		this.trigger("shouldScrollToBottom");
	}, "content.@each"),

	respond: function (input) {
		this.startThinking();
		if (!this.get("isDisambiguating")) {
  		var raw = App.NLP.parse(input);
  		if (!raw.action) {
  			App.Store.appendToTimeline({
		  		type: "error",
		  		text: "I'm not sure what you mean."
		  	});
  		} else {
  			this.set("isDisambiguating", true);
  			this.startThinking();
  			App.NLP.startDisambiguation(raw, function (disambig) {
  				this.set("isDisambiguating", false);

  				var event = Ember.copy(disambig);
  				event.type = "rule";
  				App.Store.appendToTimeline(event);

  				var job = {
  					"first_name": disambig.action.recipient["first_name"],
  					"last_name": disambig.action.recipient["last_name"],
  					"action_type": disambig.action.method,
  					"text_body": disambig.action.content,
  					"latitude": "",
  					"longitude": "",
  					"action_time": ""
  				};

  				if (disambig.condition.type == "time") {
  					job.action_time = disambig.condition.to.toISOString();
  				}

  				if (disambig.condition.type == "location") {
  					job.latitude = disambig.condition.lat;
  					job.longitude = disambig.condition.lon;
  				}

  				App.API.createJob(job, function () {});
  			}.bind(this), this);
  		}
  	} else {
  		if (input.toLowerCase() == "cancel") {
  			App.NLP.endDisambiguation();
  			this.et("isDisambiguating", false);
  		}

  		App.NLP.fillDisambiguation(input);
  	}
	},

	actions: {
  	tell: function (input) {
  		App.Store.appendToTimeline({
	  		type: "quote",
	  		text: input
	  	});

  		this.set("input", "");
  		this.respond(input);
  	}
  }
});

App.EventController = Ember.ObjectController.extend({
	isQuote: Ember.computed(function () {
		return this.get("type") == "quote";
	}).property("type"),

	isError: Ember.computed(function () {
		return this.get("type") == "error";
	}).property("type"),

	isQuestion: Ember.computed(function () {
		return this.get("type") == "question";
	}).property("type"),

	isRule: Ember.computed(function () {
		return this.get("type") == "rule";
	}).property("type"),

	isConditionLocation: Ember.computed(function () {
		return this.get("condition.type") == "location";
	}).property("condition.type"),

	isConditionTime: Ember.computed(function () {
		return this.get("condition.type") == "time";
	}).property("condition.type"),

	conditionTime: Ember.computed(function () {
		var time = this.get("condition.to");
		if (time instanceof Date) {
			return time.toString("'MMMM d, yyyy");
		} else {
			return "";
		}
	}).property("condition.to")
});

App.IndexView = Ember.View.extend({
	didInsertElement: function () {
		var controller = this.get("controller");

		this.scrollToBottom();
		controller.on("shouldScrollToBottom", function () {
			this.scrollToBottom();
		}.bind(this));
	},

	scrollToBottom: function () {
		var timeline = this.$(".app-timeline");
		timeline[0].scrollTop = timeline[0].scrollHeight;
	}
});

App.SpeechTextField = Ember.TextField.extend({
	attributeBindings: ['x-webkit-speech'],
	"x-webkit-speech": true,
	didInsertElement: function () {
		this.$().bind("webkitspeechchange", function () {
			this.sendAction('action', this.$().val());
		}.bind(this));
	}
});

App.MapImageComponent = Ember.Component.extend({
	apiKey: 'AIzaSyDXHMEMgDLFodaZ15stoyhiktANB3lgcBA',
	lat: 0,
	lon: 0,

	mapUrl: Ember.computed(function () {
		var lat = this.get('lat'),
			  lon = this.get('lon'),
			  apiKey = this.get('apiKey');

		return 'http://maps.googleapis.com/maps/api/staticmap?size=500x200' +
		       '&zoom=14&markers=color:blue%7Clabel:S%7C' + lat + ',' + lon +
		       '&visual_refresh=true&sensor=false&api_key=' + apiKey;
	}).property('lat', 'lon', 'apiKey')
});
