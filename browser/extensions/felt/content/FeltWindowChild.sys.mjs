/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

console.debug(`FeltExtension: FeltWindowChild.sys.mjs`);

export class FeltWindowChild extends JSWindowActorChild {
  actorCreated() {
    console.debug(`FeltExtension: FeltParent.sys.mjs: FeltWindowChild: getActor()`);   
    this.actor = ChromeUtils.domProcessChild.getActor("FeltProcess");
    console.debug(`FeltExtension: FeltParent.sys.mjs: FeltWindowChild: getActor(): actor=${this.actor}`);   
  }

  // Only handle DOMContentLoaded on https://sso.mozilla.com/dashboard
  handleEvent(event) {
    if (event.type !== "DOMContentLoaded") {
      console.error(`Unexpected event.type=${event.type}`);
      return;
    }

    this.actor.sendAsyncMessage("FeltChild:StartFirefox", {});
  }

}
