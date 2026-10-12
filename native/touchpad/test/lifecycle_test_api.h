#pragma once
#include <windows.h>

HWND WINAPI LifecycleCreateWindow(DWORD, LPCWSTR, LPCWSTR, DWORD, int, int, int, int,
                                  HWND, HMENU, HINSTANCE, LPVOID);
DWORD WINAPI LifecycleWaitSingle(HANDLE, DWORD);
DWORD WINAPI LifecycleWaitMultiple(DWORD, const HANDLE*, BOOL, DWORD);

BOOL WINAPI LifecycleModuleHandle(DWORD, LPCWSTR, HMODULE*);
ATOM WINAPI LifecycleRegisterClass(const WNDCLASSW*);
BOOL WINAPI LifecycleClassInfo(HINSTANCE, LPCWSTR, LPWNDCLASSW);
BOOL WINAPI LifecycleUnregisterClass(LPCWSTR, HINSTANCE);
UINT WINAPI LifecycleRegisteredDevices(PRAWINPUTDEVICE, PUINT, UINT);
BOOL WINAPI LifecycleRegisterDevices(PCRAWINPUTDEVICE, UINT, UINT);
LRESULT WINAPI LifecycleDefWindowProc(HWND, UINT, WPARAM, LPARAM);
UINT WINAPI LifecycleRawInputData(HRAWINPUT, UINT, LPVOID, PUINT, UINT);

// Only the isolated test executable uses these deterministic failure boundaries.
#define GetModuleHandleExW LifecycleModuleHandle
#define RegisterClassW LifecycleRegisterClass
#define GetClassInfoW LifecycleClassInfo
#define UnregisterClassW LifecycleUnregisterClass
#define GetRegisteredRawInputDevices LifecycleRegisteredDevices
#define RegisterRawInputDevices LifecycleRegisterDevices
#define DefWindowProcW LifecycleDefWindowProc
#define GetRawInputData LifecycleRawInputData
#define CreateWindowExW LifecycleCreateWindow
#define WaitForSingleObject LifecycleWaitSingle
#define WaitForMultipleObjects LifecycleWaitMultiple
