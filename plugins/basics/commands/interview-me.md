I want you to start a timer in the background and just interview me. Do a little discovery call with me so that you can learn more about me and what I'm trying to do here.

$ARGUMENTS

(default: 5 mins)

## Setup

First, start a background timer and store the process ID:

```bash
sleep 300 & echo $! > /tmp/discovery-timer-pid && echo "Timer started"
```

This starts a 5-minute timer. Adjust 300 (seconds) if the user requests a different duration.

## After Every User Response

Check remaining time by running:

```bash
pid=$(cat /tmp/discovery-timer-pid 2>/dev/null) && if ps -p $pid > /dev/null 2>&1; then start_time=$(ps -o lstart= -p $pid | xargs -I {} date -j -f "%c" "{}" "+%s" 2>/dev/null) && now=$(date "+%s") && elapsed=$((now - start_time)) && remaining=$((300 - elapsed)) && echo "~$remaining seconds remaining (~$((remaining/60)) min)"; else echo "Timer complete"; fi
```

Don't overwhelm with multiple questions. One question, wait for response, check timer, next question.
