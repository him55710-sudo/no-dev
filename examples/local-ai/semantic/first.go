package sample

func First(items []string) (string, bool) {
    if len(items) == 0 {
        return "", false
    }
    return items[0], true
}
