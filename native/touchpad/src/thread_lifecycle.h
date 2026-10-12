#ifndef GESTURE_FLOW_THREAD_LIFECYCLE_H_
#define GESTURE_FLOW_THREAD_LIFECYCLE_H_

namespace gestureflow {
enum class ThreadStartResult {
  kStarted, kAlreadyRunning, kUnavailable, kFailed, kTimedOut, kStopPending
};
enum class ThreadStopResult { kStopped, kAlreadyStopped, kPending };
}  // namespace gestureflow

#endif
