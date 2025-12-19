/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#ifndef ModemManagerImeiProvider_h
#define ModemManagerImeiProvider_h

#include <gio/gio.h>
#include <glib.h>

#include "mozilla/RefPtr.h"
#include "nsIImeiProvider.h"

namespace mozilla::dom {

class ModemManagerImeiProvider final : public nsIImeiProvider {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIIMEIPROVIDER

  ModemManagerImeiProvider() = default;
  static already_AddRefed<ModemManagerImeiProvider> GetInstance();

 private:
  ~ModemManagerImeiProvider() = default;

  RefPtr<GCancellable> mCancellable;

  void CollectImei(RefPtr<Promise>);
};

}  // namespace mozilla::dom

#endif /* ModemManagerImeiProvider_h */
