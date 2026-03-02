import { Util } from '../core/util.js';
import { Component } from '../core/component';
import { computePosition, flip, shift, offset, arrow as arrowMiddleware } from '@floating-ui/dom';
import { chi } from '../core/chi';

const COMPONENT_SELECTOR = '[data-popover-content]';
const COMPONENT_TYPE = 'popover';
const CLASS_POPOVER = 'chi-popover';
const TRANSITION_DURATION = 200;
const EVENTS = {
  SHOW_DEPRECATED: 'chi.popover.show',
  HIDE_DEPRECATED: 'chi.popover.hide',
  SHOW: 'chiPopoverShow',
  HIDE: 'chiPopoverHide',
  SHOWN: 'chiPopoverShown',
  HIDDEN: 'chiPopoverHidden'
};
const DEFAULT_CONFIG = {
  animate: true,
  arrow: true,
  classes: [],
  content: null,
  delayBetweenInteractions: 50,
  parent: null,
  position: 'top',
  trigger: 'click',
  preventAutoHide: false
};

class Popover extends Component {
  constructor(elem, config) {
    super(elem, Util.extend(DEFAULT_CONFIG, config));

    this._popoverElem = null;
    this._floatingCleanup = null;
    this._preAnimationTransformStyle = null;
    this._postAnimationTransformStyle = null;
    this._shown = false;
    this._config.parent = this._config.parent || this._elem;
    this._config.position =
      (config && config.position) ||
      (this._elem && this._elem.dataset && this._elem.dataset.position) ||
      (this._config.parent &&
        this._config.parent.dataset &&
        this._config.parent.dataset.position) ||
      this._config.position;

    this._configurePopover();
    this._initDefaultEventListeners();
  }

  _initDefaultEventListeners() {
    let self = this;

    this._mouseClickOnPopover = function() {
      self._closeOnClickOnDocument = false;
    };

    this._addEventHandler(
      this._popoverElem,
      'click',
      this._mouseClickOnPopover
    );

    if (!this._config.preventAutoHide) {
      this._mouseClickOnDocument = function() {
        if (self._closeOnClickOnDocument) {
          self.hide();
        } else {
          self._closeOnClickOnDocument = true;
        }
      };

      this._addEventHandler(document, 'click', this._mouseClickOnDocument);
    }

    if (this._config.trigger === 'click') {
      this._mouseClickEventHandler = function() {
        self._closeOnClickOnDocument = false;
        self.toggle();
      };

      this._addEventHandler(this._elem, 'click', this._mouseClickEventHandler);
    }
  }

  static get componentType() {
    return COMPONENT_TYPE;
  }

  static get componentSelector() {
    return COMPONENT_SELECTOR;
  }

  show(force) {
    if (this._shown || (!this.allowConsecutiveActions() && !force)) {
      return;
    }

    this._shown = true;
    this._elem.dispatchEvent(Util.createEvent(EVENTS.SHOW_DEPRECATED)); // To be removed in Chi 4.0
    this._elem.dispatchEvent(Util.createEvent(EVENTS.SHOW));

    if (!this._config.animate) {
      Util.addClass(this._popoverElem, chi.classes.ACTIVE);
      this._popoverElem.setAttribute('aria-hidden', 'false');
      return;
    }

    const self = this;
    const transition = this._popoverElem.style.transition;
    self._popoverElem.style.transition = 'none';
    Util.addClass(self._popoverElem, chi.classes.TRANSITIONING);

    // computePosition is async — wait for position to be computed before animating
    self._updatePosition().then(function() {
      Util.threeStepsAnimation(
        function() {
          self._popoverElem.style.transform = self._preAnimationTransformStyle;
        },
        function() {
          Util.addClass(self._popoverElem, chi.classes.ACTIVE);
          self._popoverElem.style.transition = transition;
          self._popoverElem.style.transform = self._postAnimationTransformStyle;
        },
        function() {
          Util.removeClass(self._popoverElem, chi.classes.TRANSITIONING);
          self._popoverElem.setAttribute('aria-hidden', 'false');
          self._popoverElem.dispatchEvent(
            Util.createEvent(EVENTS.shown)
          );
        },
        TRANSITION_DURATION
      );
    });
  }

  hide(force) {
    if (!this._shown || (!this.allowConsecutiveActions() && !force)) {
      return;
    }

    this._shown = false;
    this._elem.dispatchEvent(Util.createEvent(EVENTS.HIDE_DEPRECATED)); // To be removed in Chi 4.0
    this._elem.dispatchEvent(Util.createEvent(EVENTS.HIDE));

    if (!this._config.animate) {
      Util.removeClass(this._popoverElem, chi.classes.ACTIVE);
      this._popoverElem.setAttribute('aria-hidden', 'true');
      return;
    }

    let self = this;
    Util.threeStepsAnimation(
      function() {
        Util.addClass(self._popoverElem, chi.classes.TRANSITIONING);
      },
      function() {
        self._popoverElem.style.transform = self._preAnimationTransformStyle;
        Util.removeClass(self._popoverElem, chi.classes.ACTIVE);
      },
      function() {
        Util.removeClass(self._popoverElem, chi.classes.TRANSITIONING);
        self._popoverElem.setAttribute('aria-hidden', 'true');
        self._popoverElem.dispatchEvent(
          Util.createEvent(EVENTS.HIDDEN)
        );
      },
      TRANSITION_DURATION
    );
  }

  allowConsecutiveActions() {
    const now = new Date();
    const nowInMillis = now.getTime();
    if (!this.lastActioned) {
      this.lastActioned = nowInMillis;
      return true;
    } else if (
      nowInMillis - this.lastActioned >
      this._config.delayBetweenInteractions
    ) {
      this.lastActioned = nowInMillis;
      return true;
    } else {
      return false;
    }
  }

  toggle() {
    if (this._shown) {
      this.hide();
    } else {
      this.show();
    }
  }

  resetPosition() {
    this._updatePosition();
  }

  _configurePopover() {
    this._configurePopoverElement();
    this._configurePopoverClasses();
    this._configurePopoverContent();
    this._configurePopoverIdAria();
    this._configurePopoverFloating();
  }

  _configurePopoverElement() {
    const target =
      (this._elem.dataset && this._elem.dataset.target) || this._config.target;

    if (target) {
      if (target instanceof Element) {
        this._popoverElem = target;
      } else {
        this._popoverElem = document.querySelector(target);
      }
    } else {
      this._popoverElem = document.createElement('section');
      this._config.parent.parentNode.appendChild(this._popoverElem);
    }
  }

  _configurePopoverClasses() {
    const self = this;
    Util.addClass(this._popoverElem, CLASS_POPOVER);
    this._config.classes.forEach(function(className) {
      Util.addClass(self._popoverElem, className);
    });

    if (!this._config.arrow) {
      Util.addClass(self._popoverElem, '-no-arrow');
    }

    if (this._config.animate) {
      Util.addClass(this._popoverElem, chi.classes.ANIMATED);
    }
  }

  _configurePopoverContent() {
    const content = this._config.content || this._elem.dataset.popoverContent;
    if (content) {
      this.setContent(content);
    }
    if (this._config.arrow) {
      const arrow = document.createElement('div');
      arrow.className = 'chi-popover__arrow';
      this._popoverElem.appendChild(arrow);
    }
  }

  _configurePopoverIdAria() {
    this._popoverElem.id =
      this._popoverElem.id ||
      'chi-' + COMPONENT_TYPE + '-' + this.componentCounterNo;
    this._config.parent.setAttribute('aria-describedby', this._popoverElem.id);
    this._popoverElem.setAttribute('aria-hidden', 'true');
    this._popoverElem.setAttribute('role', 'dialog');
    if (this._popoverElem.querySelector('.chi-popover__title')) {
      this._popoverElem.setAttribute(
        'aria-label',
        this._popoverElem.querySelector('.chi-popover__title').innerHTML
      );
    }
    this._popoverElem.setAttribute('aria-modal', 'true');
  }

  _configurePopoverFloating() {
    const self = this;
    const arrowEl = this._config.arrow
      ? this._popoverElem.querySelector('.chi-popover__arrow')
      : null;

    const OPPOSITE_SIDE = {
      top: 'bottom',
      right: 'left',
      bottom: 'top',
      left: 'right',
    };

    // Clip-path polygons for each arrow direction.
    // Applied to ::before via --chi-arrow-clip CSS custom property.
    const ARROW_CLIP_PATHS = {
      top: 'polygon(100% 0, 0 100%, 100% 100%)',
      bottom: 'polygon(0 0, 100% 0, 0 100%)',
      left: 'polygon(0 0, 100% 0, 100% 100%)',
      right: 'polygon(0 0, 0 100%, 100% 100%)',
    };

    this._updatePosition = function() {
      const middleware = [
        offset(self._config.arrow ? 12 : 0),
        flip(),
        shift(),
      ];

      if (arrowEl) {
        middleware.push(arrowMiddleware({ element: arrowEl }));
      }

      return computePosition(self._config.parent, self._popoverElem, {
        placement: self._config.position,
        middleware: middleware,
      }).then(({x, y, placement, middlewareData}) => {
        Object.assign(self._popoverElem.style, {
          position: 'absolute',
          left: `${x}px`,
          top: `${y}px`,
        });

        const basePlacement = placement.split('-')[0];

        // Update placement class on popover for CSS arrow styling
        ['top', 'bottom', 'left', 'right'].forEach(function(side) {
          Util.removeClass(self._popoverElem, 'chi-popover--' + side);
        });
        Util.addClass(self._popoverElem, 'chi-popover--' + basePlacement);

        // Apply arrow positioning
        if (arrowEl && middlewareData.arrow) {
          const {x: arrowX, y: arrowY} = middlewareData.arrow;
          const staticSide = OPPOSITE_SIDE[basePlacement];

          // Measure arrow size for static-side offset
          const arrowLen = (basePlacement === 'top' || basePlacement === 'bottom')
            ? arrowEl.offsetHeight
            : arrowEl.offsetWidth;

          Object.assign(arrowEl.style, {
            left: arrowX != null ? `${arrowX}px` : '',
            top: arrowY != null ? `${arrowY}px` : '',
            right: '',
            bottom: '',
            [staticSide]: `${-(arrowLen / 2)}px`,
          });

          // Set clip-path direction on arrow ::before via CSS custom property
          arrowEl.style.setProperty(
            '--chi-arrow-clip',
            ARROW_CLIP_PATHS[basePlacement] || 'none'
          );
        }

        // Animation transforms are RELATIVE offsets — left/top handles absolute positioning.
        // Post = final position (no additional transform needed).
        // Pre = 20px offset in the incoming direction for slide-in animation.
        self._postAnimationTransformStyle = 'none';
        if (basePlacement === 'top') {
          self._preAnimationTransformStyle = 'translate3d(0, 20px, 0)';
        } else if (basePlacement === 'right') {
          self._preAnimationTransformStyle = 'translate3d(-20px, 0, 0)';
        } else if (basePlacement === 'bottom') {
          self._preAnimationTransformStyle = 'translate3d(0, -20px, 0)';
        } else if (basePlacement === 'left') {
          self._preAnimationTransformStyle = 'translate3d(20px, 0, 0)';
        } else {
          self._preAnimationTransformStyle = 'none';
        }
      });
    };

    // Initial position computation
    this._updatePosition();
  }

  setContent(content) {
    Util.empty(this._popoverElem);
    if (content instanceof Element) {
      this._popoverElem.appendChild(content);
    } else {
      this._popoverElem.innerHTML = content;
    }
  }

  dispose() {
    this._removeEventHandlers();
    if (this._popoverElem && this._popoverElem.parentNode) {
      this._popoverElem.parentNode.removeChild(this._popoverElem);
    }
    this._popoverElem = null;
    this._floatingCleanup = null;
    this._config = null;
    this._preAnimationTransformStyle = null;
    this._postAnimationTransformStyle = null;

    this._mouseClickOnDocument = null;
    this._mouseClickOnPopover = null;
    this._mouseClickEventHandler = null;

    this._elem = null;
  }
}

const factory = Component.factory.bind(Popover);
export { Popover, factory };
