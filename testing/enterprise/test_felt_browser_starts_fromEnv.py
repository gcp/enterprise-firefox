#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import sys

import portpicker
from felt_browser_starts import FeltStartsBrowser


class FeltStartsBrowserEnv(FeltStartsBrowser):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)


if __name__ == "__main__":
    port_console = portpicker.pick_unused_port()
    port_sso_serv = portpicker.pick_unused_port()
    FeltStartsBrowserEnv(
        "felt_browser_starts_fromEnv.json",
        firefox=sys.argv[1],
        geckodriver=sys.argv[2],
        profile_root=sys.argv[3],
        console=port_console,
        sso_server=port_sso_serv,
        env_vars={"MOZ_FELT_UI": "1"},
    )
