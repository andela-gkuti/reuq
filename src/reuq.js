"use strict";

function Reuq(controller) {
  var rq = this;
  this.templates = {};
  this.controller = controller;
  this.utils = this.getUtils();

  this._storeTemplates();
  // submit
  $('body').on('submit', '[lib-form]:not([lib-tmpl] [lib-form]):not([lib-tmpl][lib-form])', function(e) {
    e.preventDefault();
    rq.utils.submit($(this))
  });

  (function(rq) {
    var resources = rq.controller.resources;
    var locals = rq.controller.locals || {};

    Object.keys(locals).forEach(function(name) {
      rq.setLocal(name, rq.getLocal(name));
    });
    //load all resources set to autoload
    Object.keys(resources).forEach(function(resourceName) {
      // if autoload is not set, autoload it by default
      if (resources[resourceName]['autoload'] === undefined || resources[resourceName]['autoload']) {
        rq.getResource(resourceName, true);
        rq.render(resourceName, null);
      }
    });

    rq.addEvents();
    // should this be run 1st inetead?
    if (typeof rq.controller.onInit === 'function') {
      rq.controller.onInit.apply(rq);
    }
  })(this);
}

//render
Reuq.prototype.render = function(templateName, data) {
  var processedTemplate = this._processTemplate(templateName, data);
  this._render(templateName, processedTemplate);
}

Reuq.prototype._processTemplate = function(templateName, data) {
  var rq = this;

  function compile(template, data) {
    template = template.replace(/\[\[(\w+)\]\]/g, function(){
      var expression = arguments[1];
      return data[expression] || rq.controller.fn[expression].apply(data);
    });
    return template;
  }

  var templateObj = this.templates[templateName];
  var resourceName = templateObj.resourceName;
  var template = templateObj.html;
  var $template = $(template);

  // process lib-rsrc-loading
  if (resourceName && this.controller.resources[resourceName].loading) {
    $template.not('[lib-rsrc-loading], [lib-rsrc-loading] *').remove();
  } else {
    $template.find('[lib-rsrc-loading], [lib-rsrc-loading] *').remove();
  }

  //process iteration
  $template.find('[lib-iter], [lib-iter-self]').each(function(id, el) {
    var $el = $(el);

    if ($el.is("[lib-iter]")) {
      var listKey = $el.attr('lib-iter');
      var list = data[listKey] || [];
    } else {
      // then it's lib-iter-self
      var list = data || [];
    }
    list.forEach(function(listItem) {
      var $compiled = $(compile($el.prop('outerHTML'), listItem));
      $compiled.removeAttr('lib-iter');
      $el.after($compiled);
    });
    $el.remove();
  });

  //process ifs
  $template.find('[lib-if]').each(function(id, el) {
    var $el = $(el);
    var condition = $el.attr('lib-if');
    if (!data[condition]) {
      $el.remove();
    }
  })

  //process if-nots
  $template.find('[lib-if-not]').each(function(id, el) {
    var $el = $(el);
    var condition = $el.attr('lib-if-not');
    if (data[condition]) {
      $el.remove();
    }
  });

  template = $template.prop('outerHTML');
  $template = $(compile(template, data))

  //process src
  $template.find('[lib-src]').each(function(id, el) {
    var $el = $(el);
    $el.attr('src', $el.attr('lib-src'));
    $el.removeAttr('lib-src');
  })

  return $template.prop('outerHTML');
}

Reuq.prototype._render = function(templateName, processedTemplate) {
  //remove previously rendered template
  $('[from-tmpl=' + templateName + ']').remove();

  var $template = $('[lib-tmpl][lib-tmpl=' + templateName + ']');
  var $newTemplate = $(processedTemplate).removeAttr('hidden').removeAttr('lib-tmpl');
  $newTemplate.attr('from-tmpl', templateName);
  $template.after($newTemplate);
  this.addEvents($newTemplate);
}

//renderEach
Reuq.prototype.renderEach = function(templateName, dataList) {
  var rq = this;

  var subTemplates = dataList.map(function(data) {
    return rq._processTemplate(templateName, data);
  });
  this._render(templateName, subTemplates.join(''));
}

//renderData
//TODO automatically subscribe templates to resource changes
Reuq.prototype.renderData = function(templateName, data) {
  this.render(templateName, data);
}

Reuq.prototype.cacheIsValid = function(resourceName) {
  var resource = this.controller.resources[resourceName]

  if (resource.shouldReload) {
    return false;
  } else {
    var cacheTimeout = resource.cacheTimeout || 10; //minutes
    var timeoutDate = new Date(resource.updatedAt.getTime() + cacheTimeout * 60000);
    return timeoutDate > new Date();
  }
}

Reuq.prototype.invalidateResourceCache = function(resourceName) {
  this.controller.resources[resourceName].shouldReload = true;
}

Reuq.prototype.getResource = function(resourceName, force, cb) {
  // coerce optional arguments to appropriate values
  if (arguments.length < 3 && typeof force === 'function') {
    cb = force;
    force = false;
  }
  var rq = this;
  var resource = this.controller.resources[resourceName];
  if (resource.data && !force && this.cacheIsValid(resourceName)) {
    cb(resource.data);
  } else {
    resource.loading = true;

    var url = typeof resource.url === 'function' ? resource.url(this) : resource.url;
    $.ajax({
      url: url,
      beforeSend: function(xhr) {
        Object.keys(resource.headers || {}).forEach(function(header){
          xhr.setRequestHeader(header, resource.headers[header]);
        })
      },
      success: function(resp) {
        resource.loading = false;
        resource.loaded = true;

        rq.setResource(resourceName, resource.dataKey ? resp[resource.dataKey] : resp);

        if (typeof cb === 'function') {
          cb(resource.data);
        }
      }
    })
  }
}

Reuq.prototype.setResource = function(resourceName, data) {
  var rq = this;
  var resource = this.controller.resources[resourceName];
  resource.data = data;
  resource.shouldReload = false;
  resource.updatedAt = new Date();
  this.runResourceSubscribers(resourceName, data);

  $('[lib-tmpl][lib-rsrc=' + resourceName + ']:not([manual-render])').each(function(id, el) {
    rq.renderData($(el).attr('lib-tmpl'), data);
  });
}

Reuq.prototype.runResourceSubscribers = function(resourceName, data) {
  var resource = this.controller.resources[resourceName];
  data = data || resource.data;
  this.runSubscribers(resource.subscribers, data)
}

Reuq.prototype.updateResource = function(resourceName, cb) {
  var rq = this;
  this.getResource(resourceName, function(data) {
    rq.setResource(resourceName, cb(data));
  });
}

Reuq.prototype.setLocal = function(name, data) {
  var rq = this;
  var local = this.controller.locals[name];
  local.data = data;
  this.runLocalSubscribers(name, data);

  $('[lib-tmpl][lib-local=' + name + ']:not([manual-render])').each(function(id, el) {
    rq.renderData($(el).attr('lib-tmpl'), data);
  });
}

Reuq.prototype.getLocal = function(name) {
  return this.controller.locals[name].data;
}

Reuq.prototype.updateLocal = function(name, cb) {
  var data = this.getLocal(name);
  this.setLocal(name, cb(data));
}

Reuq.prototype.runLocalSubscribers = function(name, data) {
  var local = this.controller.locals[name];
  data = data || local.data;
  this.runSubscribers(local.subscribers, data);
}

Reuq.prototype.runSubscribers = function(subscribers, data) {
  var rq = this;
  if (subscribers) {
    subscribers.forEach(function(subscriber) {
      var path = subscriber.split('.');
      var fn = rq.controller[path[0]][path[1]];
      fn.apply(rq, [data]);
    })
  }
}

//storeTemplates
Reuq.prototype._storeTemplates = function() {
  var rq = this;
  $('[lib-tmpl]').each(function(id, el) {
    var $el = $(el);
    rq.templates[$el.attr('lib-tmpl')] = {
      html: $el.prop('outerHTML'),
      dom: $el,
      dataKey: $el.attr('lib-data'),
      resourceName: $el.attr('lib-rsrc')
    };
  });
}

Reuq.prototype.addEvents = function($dom) {
  $dom = $dom || $('body');
  var rq = this;
  var evtSelector = '[lib-evt]:not([lib-tmpl] [lib-evt]):not([lib-tmpl][lib-evt])';
  $dom.find(evtSelector).addBack(evtSelector).each(function(id, el) {
    var $el = $(el);
    var evtConfig = $el.attr('lib-evt').split(' ')
    var evtType = evtConfig[0];
    var evtHandler = rq.controller.eventHandlers[evtConfig[1]];
    $el.on(evtType, function(e) {
      var handlerArgs = [$el].concat(evtConfig.slice(2))
      evtHandler.apply(rq, handlerArgs);
    })
  });
}

Reuq.prototype.getUtils = function() {
  var rq = this;
  console.log(rq);

  return {
    submit: function(form) {
      var data = form.serialize();
      var url = form.attr('action');
      var type = form.attr('method');

      $.ajax({ type: type, url: url, data: data })
        .done(function(data, status, jqXHR) {
          var cb = form.attr('lib-cb-done');
          if (cb) {
            rq.controller.callbacks[cb](data, status, form);
          }
        })
        .fail(function(jqXHR, status, error) {
          var cb = form.attr('lib-cb-fail');
          if (cb) {
            rq.controller.callbacks[cb](error, status, form, jqXHR);
          }
        });
    }
  }
}

$('head').append('<style type="text/css">[lib-tmpl] {display: none !important;}</style>');
window.Rq = window.Reuq = Reuq;
