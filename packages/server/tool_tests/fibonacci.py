def fibonacci(n):
    """
    Calculate the nth Fibonacci number recursively.

    Args:
        n (int): The position in the Fibonacci sequence (n >= 0)

    Returns:
        int: The nth Fibonacci number
    """
    if n <= 1:
        return n
    else:
        return fibonacci(n-1) + fibonacci(n-2)


# Test block: Demonstrates the fibonacci function by printing the first 10 Fibonacci numbers
if __name__ == "__main__":
    # Test the function with some values
    for i in range(10):
        print(f"fibonacci({i}) = {fibonacci(i)}")