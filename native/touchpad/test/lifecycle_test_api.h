#pragma once
#include <windows.h>

HWND WINAPI LifecycleCreateWindow(DWORD, LPCWSTR, LPCWSTR, DWORD, int, int, int, int,
                                  HWND, HMENU, HINSTANCE, LPVOID);
DWORD WINAPI LifecycleWaitSingle(HANDLE, DWORD);
DWORD WINAPI LifecycleWaitMultiple(DWORD, const HANDLE*, BOOL, DWORD);

// Only the isolated test executable uses these deterministic failure boundaries.
#define CreateWindowExW LifecycleCreateWindow
#define WaitForSingleObject LifecycleWaitSingle
#define WaitForMultipleObjects LifecycleWaitMultiple
