#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import sys

import portpicker
from felt_browser_starts import FeltStartsBrowser


class FeltStartsBrowserCli(FeltStartsBrowser):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)


if __name__ == "__main__":
    port_console = portpicker.pick_unused_port()
    port_sso_serv = portpicker.pick_unused_port()
    FeltStartsBrowserCli(
        "felt_browser_starts_fromCli.json",
        firefox=sys.argv[1],
        geckodriver=sys.argv[2],
        profile_root=sys.argv[3],
        console=port_console,
        sso_server=port_sso_serv,
        cli_args=["-feltUI"],
    )
