{
  "includes": [
    "build_env.gypi"
  ],
  "targets": [
    {
      "target_name": "gesture_flow_touchpad",
      "sources": [
        "src/main.cpp",
        "src/hid_descriptor.cpp",
        "src/frame_assembler.cpp",
        "src/raw_input_capture.cpp",
        "src/gestures_controller.cpp"
      ],
      "include_dirs": [
        "src",
        "<(cppwinrt_dir)"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "_WIN32_WINNT=0x0A00",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX",
        "UNICODE",
        "_UNICODE",
        "GESTURE_FLOW_NATIVE_EXPORTS",
        "GESTURE_FLOW_HAVE_TG_CONTROLLER=<(have_tg_controller)"
      ],
      "cflags_cc": [
        "/std:c++17",
        "/EHsc",
        "/permissive-"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "user32.lib",
              "advapi32.lib",
              "ole32.lib",
              "runtimeobject.lib",
              "windowsapp.lib",
              "hid.lib"
            ]
          }
        ]
      ]
    }
  ]
}
