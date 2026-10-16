def batch_count(count: int, size: int = 4) -> int:
    if size <= 0:
        raise ValueError("size must be positive")
    if count <= 0:
        return 0
    return (count + size - 1) // size
