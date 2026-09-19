# Windows installer resilience

## Scope

This note records three field failures in the Windows NSIS installer and the
corresponding product guarantees:

1. a process check based on `Get-CimInstance Win32_Process` could block first
   install or upgrade when CIM returned `0x800705AF`;
2. an interactive installer started with another account's administrator
   credentials could resolve per-user paths under that credentialed account;
3. a reported install created an unbounded sequence below
   `%LOCALAPPDATA%\Temp\SampleDir\_wedax.exe\...` until the system drive filled.

The third path is not emitted anywhere in this repository. It is consistent
with an extractor, sandbox, or endpoint-security hook reacting to the packaged
executable, but the creating process must be confirmed from ProcMon or an EDR
event before attributing ownership. The installer can bound its own extractor
and direct child processes; it cannot terminate an independent security-product
process, so that case remains an attribution and vendor-escalation issue.

## Required behavior

### Native Windows architecture

The installed Electron application and its production runtime remain x64. The
standard electron-builder NSIS installer, uninstaller, and elevation helper may
run as x86 compatibility processes during install, update, or uninstall. This
does not change the architecture of the installed application.

A PE-header audit of the release candidate found the application executable to
be AMD64, while the NSIS setup executable and packaged `resources/elevate.exe`
helper are x86. Passing `--x64` selects the application payload architecture;
it does not change the standard NSIS stub or its helper plug-ins.

Migrating the installation chain to x64 MSI solely to remove Task Manager's
temporary `32 bit` label is intentionally out of scope for this resilience fix.
Such a migration would also require compatibility work for existing NSIS
installations and the automatic-update flow. It should be evaluated and tested
as a separate project rather than combined with the account, process-check, and
temporary-storage corrections in this change.

### Process handling

- A pristine install, with no per-user or per-machine registration and an empty
  target directory, does not start the PowerShell helper. No previous process
  tree or runtime exists to protect or stage.
- Upgrade checks use `Get-Process` plus the executable path and do not depend on
  CIM/WMI.
- Matching remains scoped to the selected installation root. It must not kill
  another installation, a portable copy, or an unrelated process with the same
  name.
- A healthy installed application still receives the graceful update shutdown
  request before the bounded force-close fallback.

This is an incremental hardening step. A future implementation should replace
PowerShell inspection with a small native Restart Manager/path-aware helper so
the final upgrade lock decision has no PowerShell dependency.

### Account ownership

The assisted installer continues to offer both **current user** and **all
users**. **Current user remains the default**; setup does not force either
mode.

For an interactive installer that starts elevated outside electron-builder's
own UAC inner instance, setup re-launches itself once through the current
desktop shell before it reads `APPDATA` or `LOCALAPPDATA`. This handles “Run as
administrator” with credentials from an old account. If the user later selects
all users, the normal multi-user page performs the explicit elevation.
If the desktop shell is unavailable, an interactive elevated setup offers to
restart explicitly in `/allusers` mode; it never silently treats the credential
account as the selected current user.

Silent `/allusers` installs are not re-launched because their target is the
machine. An elevated silent current-user invocation fails with a nonzero exit
code: an asynchronous desktop-shell relaunch could not preserve completion and
exit-code semantics. It must be launched non-elevated by the target user.

### Temporary storage

- The resource extractor receives a unique temporary directory below the
  selected installation root through `TEMP`, `TMP`, and
  `JUSTDO_INSTALLER_TEMP_ROOT`.
- The extractor validates that its temporary root is a direct, session-named
  child of the selected installation root, refuses recursive cleanup when a
  reparse point is present, and removes that root on success or failure. This
  also covers the common case where setup is forcibly closed but the extractor
  is allowed to finish. Setup restores its original environment and only tries
  a non-recursive removal of the now-empty root; a locked or suspicious residual
  is retained and recorded instead of being deleted across an uncertain path.
- Setup refuses cancellation while the asynchronous extractor is active, so
  closing the wizard cannot orphan a child that continues writing.
- The extractor monitors free-space change on both the destination volume and
  the original user-temp volume, reserves 2 GiB, and verifies that the
  destination can hold the declared expansion before starting. It allows room
  for filesystem overhead and unrelated I/O, but terminates controlled
  extraction when either the growth budget or free-space floor is crossed.
- The guard logs `unexpected-disk-growth`; it does not recursively delete an
  unrecognized `SampleDir`, because ownership cannot be proven safely.

## Diagnostics

The lifecycle log remains `install-timing.log`; resource extraction details are
in `install-resource.log`. Relevant events are:

- `phase=process-check-skipped reason=pristine-install`
- `extractor-temp-root`
- `event=disk-growth-guard-started`
- `event=unexpected-disk-growth`

For a future recurrence of `SampleDir`, collect a Process Monitor trace filtered
to `Path begins with <reported SampleDir>` and include Process Name, PID,
Operation, Result, and the process tree. Do not collect file contents or command
lines containing credentials.

## Verification

- Static installer contract tests cover current-user bootstrap ordering,
  preservation of the multi-user choices, the fresh-install process skip,
  removal of CIM usage, temp isolation, cleanup, and the disk-growth guard.
- Windows integration tests execute the process helper against real processes
  and exercise resource extraction/rollback fixtures, including abnormal disk
  growth, fallback-loader failure contracts, and managed-temp cleanup.
- A release candidate should additionally be installed in two Windows accounts:
  choose current user after launching normally, choose current user after
  starting with alternate administrator credentials, and choose all users from
  a non-admin account.
- A release check should continue to assert that the installed main executable
  and production native modules are x64. The check must distinguish these from
  the intentionally x86 NSIS installer, uninstaller, and elevation helper.
